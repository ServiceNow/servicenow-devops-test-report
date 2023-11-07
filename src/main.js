const core = require('@actions/core');
const fs = require('fs');
const xml2js = require('xml2js');
const axios = require('axios');

function circularSafeStringify(obj) {
    const seen = new WeakSet();
    return JSON.stringify(obj, (key, value) => {
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
                        if(xmlData.includes('testsuites')){
                            let parsedresponse = parsedJson["testsuites"];
                            for(var i = 0; i < parsedresponse.testsuite.length; i++){
                                summaryObj = parsedresponse.testsuite[i].$;
                                totalTests = totalTests + parseInt(summaryObj.tests);
                                failedTests = failedTests + parseInt(summaryObj.failures);
                                ignoredTests = ignoredTests + parseInt(summaryObj.errors);
                                skippedTests = skippedTests + parseInt(summaryObj.skipped);
                                totalDuration = totalDuration + parseInt(summaryObj.time);
                                passedTests = totalTests - (failedTests + ignoredTests + skippedTests);
                            }
                        }
                        else if(xmlData.includes('testsuite')){
                            let parsedresponse = parsedJson["testsuite"];
                            summaryObj = parsedresponse.$;
                            totalTests = totalTests + parseInt(summaryObj.tests);
                            failedTests = failedTests + parseInt(summaryObj.failures);
                            ignoredTests = ignoredTests + parseInt(summaryObj.errors);
                            skippedTests = skippedTests + parseInt(summaryObj.skipped);
                            totalDuration = totalDuration + parseInt(summaryObj.time);
                            passedTests = totalTests - (failedTests + ignoredTests + skippedTests);
                            
                        }

                        packageName = summaryObj.name.replace(/\.[^.]*$/g, '');
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
                let parsedresponse = parsedJson["testng-results"];
                let summaryObj = parsedresponse.$;
                let suitesObj = parsedresponse.suite[0];
                let suiteObj = suitesObj.$;
                let startTime = suiteObj["started-at"];
                let endTime = suiteObj["finished-at"];
                let package = suitesObj.test[0].class[0].$;
                packageName = package.name.replace(/\.[^.]*$/g,'');
                    
                passedTests = parseInt(summaryObj.passed);
                failedTests = parseInt(summaryObj.failed);
                skippedTests = parseInt(summaryObj.skipped);
                ignoredTests = parseInt(summaryObj.ignored);
                totalTests = parseInt(summaryObj.total);
                startTime = startTime.replace(/ +\S*$/ig, 'Z');
                endTime = endTime.replace(/ +\S*$/ig, 'Z');
                totalDuration = parseInt(suiteObj["duration-ms"]);
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
            testType: 'JUnit',
            suites: []			
        }];
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
            testType: 'JUnit'
        };
        console.log("original payload is : ", JSON.stringify(payload));
    } catch (e) {
        core.setFailed(`Exception setting the payload ${e}`);
        return;
    }

    let result;
    let snowResponse;
    const endpointV1 = `${instanceUrl}/api/sn_devops/v1/devops/tool/test?toolId=${toolId}&testType=JUnit`;
    const endpointV2 = `${instanceUrl}/api/sn_devops/v2/devops/tool/test?toolId=${toolId}&testType=JUnit`;

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
        snowResponse = await axios.post(endpoint, JSON.stringify(payload), httpHeaders);
    } catch (e) {
        core.debug('[ServiceNow DevOps] Test Results, Error: '+JSON.stringify(e));
        if (e.message.includes('ECONNREFUSED') || e.message.includes('ENOTFOUND') || e.message.includes('405')) {
            core.setFailed('ServiceNow Instance URL is NOT valid. Please correct the URL and try again.');
        } else if (e.message.includes('401')) {
            core.setFailed('Invalid username and password or Invalid token and toolid. Please correct the input parameters and try again.');
            if(e.response && e.response.data) 
            {
                var responseObject=circularSafeStringify(e.response.data);
                core.debug('[ServiceNow DevOps] Test Results, Response data :'+responseObject);          
            }
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
