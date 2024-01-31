const core = require('@actions/core');
const fs = require('fs');
const xml2js = require('xml2js');
const axios = require('axios');

function circularSafeStringify(obj) {
    const seen = new WeakSet();
    return JSON.stringify(obj, (key, value) => {
        if (key === '_sessionCache') return undefined;
        if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }
      return value;
    });
}

(async function main() {
    let instanceUrl = core.getInput('instance-url', { required: true });
    const toolId = core.getInput('tool-id', { required: true });
    const username = core.getInput('devops-integration-user-name', { required: false });
    const password = core.getInput('devops-integration-user-password', { required: false });
    const devopsIntegrationToken = core.getInput('devops-integration-token', { required: false });
    const jobname = core.getInput('job-name', { required: true });
    const xmlReportFile = core.getInput('xml-report-filename', { required: true });
    
    let githubContext = core.getInput('context-github', { required: true });

    try {
        githubContext = JSON.parse(githubContext);
    } catch (e) {
        core.setFailed(`Exception parsing github context ${e}`);
        return;
    }

    let xmlData, jsonData, testSummaries, packageName;
    let totalTests = 0, passedTests = 0, failedTests = 0, skippedTests = 0, ignoredTests = 0, totalDuration = 0;
    let startTime = '', endTime = '';
    let testType = 'JUnit';
    let isError = false;
    let errorMessage = '';

    const assignJUnitValues = function(summaryObj) {
        totalTests = (totalTests + parseInt(summaryObj.tests)) || 0;
        failedTests = (failedTests + parseInt(summaryObj.failures)) || 0;
        ignoredTests = (ignoredTests + parseInt(summaryObj.errors)) || 0;
        skippedTests = (skippedTests + parseInt(summaryObj.skipped)) || 0;
        totalDuration = (totalDuration + parseFloat(summaryObj.time)) || 0;
        passedTests = totalTests - (failedTests + ignoredTests + skippedTests);
        packageName = summaryObj.name.replace(/\.[^.]*$/g, '') || xmlReportFile;
    };
    function convertDateFormatForXUnit(inputDate) {
        try{
            const [datePart, timePart] = inputDate.split(' ');
            const [month, day, year] = datePart.split('/');
            const [hours, minutes, seconds] = timePart.split(':');
            const outputDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hours}:${minutes}:${seconds}Z`;
            return outputDate;
        }catch(exception){
            core.debug(`convertDateFormatForXUnit, Failed :${exception}`);
            return '';
        }
    }
    function convertDateTimeFormatForMSTest(inputDateTime){
        try{
            const [datePart, timePart] = inputDateTime.split('T'); 
            const [year, month, day] = datePart.split('-');
            const timeWithoutOffset = timePart.replace(/\+\d+:\d+$/, '');
            const [hours, minutes, seconds] = timeWithoutOffset.split(':');
            const outputDateTime = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}Z`;
            return outputDateTime;
        }catch(exception){
            core.debug(`convertDateTimeFormatForMSTest, Failed :${exception}`);
            return '';
        }
    }
    function durationBetweenDateTime(startTime, endTime){
        try{
            const start = new Date(startTime);
            const end = new Date(endTime);
            const timeDiffInSeconds = Math.abs((start - end) / 1000);
            return timeDiffInSeconds;
        }catch(exception){
            core.debug(`durationBetweenDateTime, Failed :${exception}`);
            return 0;
        }
    }
    function addSecondsToDateTime(startTime, secondsToAdd) {
        try{
            const dateTime = new Date(startTime);
            dateTime.setSeconds(dateTime.getSeconds() + secondsToAdd);
            return dateTime.toISOString();
        }catch(exception){
            core.debug(`addSecondsToDateTime, Failed :${exception}`);
            return '';
        }
    }

    try {
        if (fs.statSync(xmlReportFile).isDirectory()) {
            let filenames = fs.readdirSync(xmlReportFile);
            console.log("\nTest Reports directory files:");
            filenames.forEach(file => {
                let filePath = xmlReportFile + '/' + file;
                if (file.endsWith('.xml')) {
                    console.log('Parsing XML file path to prepare summaries payload: ' +filePath);
                    xmlData = fs.readFileSync(filePath, 'utf8');
                    xml2js.parseString(xmlData, (error, result) => {
                        if (error) {
                            throw error;
                        }
                        // 'result' is a JavaScript object
                        // convert it to a JSON string
                        jsonData = JSON.stringify(result, null, 4);
                        let parsedJson = JSON.parse(jsonData);
                        let summaryObj;
                        if(parsedJson){
                            if(parsedJson?.testsuites){
                                let parsedresponse = parsedJson["testsuites"];
                                if(parsedresponse?.testsuite){
                                    for(var i = 0; i < parsedresponse.testsuite.length; i++){
                                        summaryObj = parsedresponse.testsuite[i].$;
                                        if(summaryObj){
                                            assignJUnitValues(summaryObj);
                                        }
                                    }
                                }
                            }
                            else if(parsedJson?.testsuite){
                                let parsedresponse = parsedJson["testsuite"];
                                summaryObj = parsedresponse?.$;
                                if(summaryObj){
                                    assignJUnitValues(summaryObj); 
                                }
                            }
                            // Unsupported test type for directory support.
                            else{
                                isError = true;
                                testType = 'Unsupported test type';
                                errorMessage = 'This test type with root node as ' + "'" + Object.keys(parsedJson)[0] + "'" + ' does not have directory support. Either the file path should include the whole path to the test (.xml) file, or this test type is currently not supported.';
                                core.setFailed(errorMessage);
                            }
                        }
                        else {
                            isError = true;
                            errorMessage = 'Test xml cannot be parsed into valid JSON.';
                            core.setFailed(errorMessage);
                        }   
                    });
                }
            });
        } else {
            xmlData = fs.readFileSync(xmlReportFile, 'utf8');
            //convert xml to json
            xml2js.parseString(xmlData, (err, result) => {
                if (err) {
                    throw err;
                }
                // 'result' is a JavaScript object
                // convert it to a JSON string
                jsonData = JSON.stringify(result, null, 4);
                let parsedJson = JSON.parse(jsonData);
                if(parsedJson){
                    // Consider TestNG as JUnit.
                    if(parsedJson?.['testng-results']){
                        let parsedresponse = parsedJson["testng-results"];
                        let summaryObj = parsedresponse?.$;
                        let suitesObj = parsedresponse?.suite[0];
                        let suiteObj = suitesObj?.$;
                        if(summaryObj && suitesObj && suiteObj){
                            startTime = suiteObj["started-at"];
                            endTime = suiteObj["finished-at"];
                            startTime = startTime.replace(" IST", "Z");
                            endTime = endTime.replace(" IST", "Z");
                            let package = suitesObj.test[0].class[0].$;
                            packageName = package.name.replace(/\.[^.]*$/g,'');  
                            passedTests = parseInt(summaryObj.passed) || 0 ;
                            failedTests = parseInt(summaryObj.failed) || 0 ;
                            skippedTests = parseInt(summaryObj.skipped) || 0 ;
                            ignoredTests = parseInt(summaryObj.ignored) || 0 ;
                            totalTests = parseInt(summaryObj.total) || 0 ;
                            totalDuration = parseFloat(suiteObj["duration-ms"]);
                        }
                    }
                    // Process XUnit test format.
                    else if(parsedJson?.assemblies){
                        let parsedresponse = parsedJson["assemblies"];
                        let testSummaryObj = (parsedresponse?.assembly[0]?.$) ? parsedresponse.assembly[0].$ : null;
                        let collectionObj = (parsedresponse?.assembly[0]?.collection[0]?.$) ? parsedresponse.assembly[0].collection[0].$ : null;
                        if(testSummaryObj || collectionObj){
                            passedTests = parseInt(testSummaryObj.passed) || parseInt(collectionObj.passed) || 0 ;
                            failedTests = parseInt(testSummaryObj.failed) || parseInt(collectionObj.failed) || 0 ;
                            skippedTests = parseInt(testSummaryObj.skipped) || parseInt(collectionObj.skipped) || 0 ;
                            totalTests = parseInt(testSummaryObj.total) || parseInt(collectionObj.total) || 0 ;
                            ignoredTests = parseInt(totalTests - (failedTests + passedTests + skippedTests));
                            totalDuration = parseFloat(testSummaryObj.time) || parseFloat(collectionObj.time) || 0 ;
                            packageName = testSummaryObj.name || collectionObj.name || xmlReportFile;
                            startTime = (parsedresponse?.$?.timestamp) ? parsedresponse.$.timestamp : "";
                            startTime = convertDateFormatForXUnit(startTime);
                            // end time is not mentioned in this type of xml. So calcute by adding startTime + totalDuration.
                            endTime = addSecondsToDateTime(startTime, totalDuration);
                            testType = 'XUnit';
                        }
                    }
                    // Process NUnit test format.
                    else if(parsedJson?.['test-run']){
                        let parsedresponse = parsedJson["test-run"]; 
                        let testSummaryObj = parsedresponse?.$;
                        if(testSummaryObj){
                            passedTests = parseInt(testSummaryObj.passed) || 0 ;
                            failedTests = parseInt(testSummaryObj.failed) || 0 ;
                            skippedTests = parseInt(testSummaryObj.skipped) || 0 ;
                            totalTests = parseInt(testSummaryObj.total) || 0 ;
                            ignoredTests = parseInt(totalTests - (failedTests + passedTests + skippedTests));
                            totalDuration = parseFloat(testSummaryObj.duration) || 0 ;
                            startTime = testSummaryObj["start-time"] || "";
                            startTime = startTime.replace(/\s+/g, ''); // convert to isoDateTime Format
                            endTime = testSummaryObj["end-time"] || "";
                            endTime = endTime.replace(/\s+/g, '');
                        }
                        packageName = (parsedresponse?.['test-suite'][0]?.$?.name) ? parsedresponse["test-suite"][0].$.name : xmlReportFile;
                        testType = 'NUnit';
                    }
                    // Process UnitTest (i.e MSTest) test format.
                    else if(parsedJson?.TestRun){
                        let parsedresponse = parsedJson["TestRun"]; 
                        let testSummaryObj = parsedresponse?.ResultSummary[0]?.Counters[0]?.$ || null;
                        if(testSummaryObj){
                            passedTests = parseInt(testSummaryObj.passed) || 0 ;
                            failedTests = parseInt(testSummaryObj.failed) || 0 ;
                            totalTests = parseInt(testSummaryObj.total) || 0 ;
                        }
                        startTime = (parsedresponse?.Times[0]?.$?.start) ? parsedresponse.Times[0].$.start : "";
                        startTime = convertDateTimeFormatForMSTest(startTime);
                        endTime = (parsedresponse?.Times[0]?.$?.finish) ? parsedresponse.Times[0].$.finish : "";
                        endTime = convertDateTimeFormatForMSTest(endTime);
                        totalDuration = durationBetweenDateTime(startTime, endTime); // calculate from start and end time.
                        skippedTests = 0; // skipped and ignored tests are not present for MSTest.
                        ignoredTests = 0;
                        packageName = (parsedresponse?.TestDefinitions[0]?.UnitTest[0]?.TestMethod[0]?.$?.className) ? parsedresponse.TestDefinitions[0].UnitTest[0].TestMethod[0].$.className : xmlReportFile;
                        testType = 'UnitTest';
                    }
                    // Support JUnit via file path as well
                    // Process pytest / jest test format.
                    else if(parsedJson?.testsuites){
                        let summaryObj;
                        let parsedresponse = parsedJson["testsuites"];
                        if(parsedresponse?.testsuite){
                            for(var i = 0; i < parsedresponse.testsuite.length; i++){
                                summaryObj = parsedresponse.testsuite[i].$;
                                assignJUnitValues(summaryObj);
                            }
                        }
                    }
                    else if(parsedJson?.testsuite){
                        let summaryObj;
                        let parsedresponse = parsedJson["testsuite"];
                        summaryObj = parsedresponse?.$;
                        assignJUnitValues(summaryObj); 
                    }
                    // Unsupported test type.
                    else{
                        isError = true;
                        testType = 'Unsupported test type';
                        errorMessage = 'This test type with root node as ' + "'" + Object.keys(parsedJson)[0] + "'" + ' is currently not supported.';
                        core.setFailed(errorMessage);
                    }
                }
                else{
                    isError = true
                    errorMessage = 'Test xml cannot be parsed into valid JSON.';
                    core.setFailed(errorMessage);
                }

            });
        }
    } catch (e) {
        core.setFailed(`Exception parsing and converting xml to json ${e}`);
        return;
    }

    let payload;
    
    try {
        instanceUrl = instanceUrl.trim();
        if (instanceUrl.endsWith('/'))
            instanceUrl = instanceUrl.slice(0, -1);

        // In case of any errors, propagate errors back to servicenow but do not process test summary. 
        if(isError === true){
            testSummaries = [];
            errorMessage = errorMessage;
        }
        else {
            testSummaries = [{
                name: packageName + '-' + githubContext.run_number + '.' + githubContext.run_attempt,
                passedTests: passedTests,
                failedTests: failedTests,
                skippedTests: skippedTests,
                ignoredTests: ignoredTests,
                blockedTests: 0,
                totalTests: totalTests,
                startTime: startTime,
                endTime: endTime,
                duration: totalDuration,
                testType: testType,
                suites: []			
            }];
        }
        console.log("test summaries payload is : ", JSON.stringify(testSummaries));
        payload = {
            toolId: toolId,
            buildNumber: githubContext.run_number,
            buildId: githubContext.run_id,
            attemptNumber: githubContext.run_attempt,
            stageName: jobname,
            workflow: `${githubContext.workflow}`,
            repository: `${githubContext.repository}`,
            testSummaries: testSummaries,
            fileContent: '',
            errorMessage: errorMessage,
            testType: testType
        };
        console.log("original payload is : ", JSON.stringify(payload));
    } catch (e) {
        core.setFailed(`Exception setting the payload ${e}`);
        return;
    }

    let result;
    let snowResponse;
    const endpointV1 = `${instanceUrl}/api/sn_devops/v1/devops/tool/test?toolId=${toolId}&testType=${testType}`;
    const endpointV2 = `${instanceUrl}/api/sn_devops/v2/devops/tool/test?toolId=${toolId}&testType=${testType}`;

    try {
        if (!devopsIntegrationToken && !username && !password) {
            core.setFailed('Either secret token or integration username, password is needed for integration user authentication');
            return;
        } else if (devopsIntegrationToken) {
            const defaultHeadersv2 = {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'sn_devops_token': `${devopsIntegrationToken}`
            };
            httpHeaders = {
                headers: defaultHeadersv2
            };
            endpoint = endpointV2;
        } else if (username && password) {
            const token = `${username}:${password}`;
            const encodedToken = Buffer.from(token).toString('base64');
            const defaultHeadersv1 = {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': 'Basic ' + `${encodedToken}`
            };
            httpHeaders = {
                headers: defaultHeadersv1 
            };
            endpoint = endpointV1;
        } else {
            core.setFailed('For Basic Auth, Username and Password is mandatory for integration user authentication');
            return;
        }
        core.debug("[ServiceNow DevOps], Sending Request for Test Report, Request options :"+JSON.stringify(httpHeaders)+", Payload :"+JSON.stringify(payload)+"\n");
        snowResponse = await axios.post(endpoint, JSON.stringify(payload), httpHeaders);
        core.debug("[ServiceNow DevOps], Receiving response for Test Report, Response :"+circularSafeStringify(snowResponse)+"\n");
    } catch (e) {
        core.debug('[ServiceNow DevOps] Test Results, Error: '+JSON.stringify(e)+"\n");
        if(e.response && e.response.data) {
            var responseObject=circularSafeStringify(e.response.data);
            core.debug('[ServiceNow DevOps] Test Results, Response data :'+responseObject+"\n");          
        }

        if (e.message.includes('ECONNREFUSED') || e.message.includes('ENOTFOUND') || e.message.includes('405')) {
            core.setFailed('ServiceNow Instance URL is NOT valid. Please correct the URL and try again.');
        } else if (e.message.includes('401')) {
            core.setFailed('Invalid username and password or Invalid token and toolid. Please correct the input parameters and try again.');
        } else if(e.message.includes('400') || e.message.includes('404')){
            let errMsg = '[ServiceNow DevOps] Test Results are not Successful. ';
            let errMsgSuffix = ' Please provide valid inputs.';
            let responseData = e.response.data;
            if (responseData && responseData.result && responseData.result.errorMessage) {
                errMsg = errMsg + responseData.result.errorMessage + errMsgSuffix;
                core.setFailed(errMsg);
            }
            else if (responseData && responseData.result && responseData.result.details && responseData.result.details.errors) {
                let errors = responseData.result.details.errors;
                for (var index in errors) {
                    errMsg = errMsg + errors[index].message + errMsgSuffix;
                }
                core.setFailed(errMsg);
            }
        } else {
            core.setFailed(`ServiceNow Test Results are NOT created. Please check ServiceNow logs for more details.`);
        }
    }
    
})();
