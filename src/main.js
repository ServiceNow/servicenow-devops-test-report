const core = require('@actions/core');
const fs = require('fs');
const xml2js = require('xml2js');
const axios = require('axios');

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

    try {
        if (fs.statSync(xmlReportFile).isDirectory()) {
            core.info('Considering it as directory.');
            let filenames = fs.readdirSync(xmlReportFile);
            console.log("\nTest Reports directory files:");
            core.info('Test Reports directory files:' + filenames);
            filenames.forEach(file => {
                let filePath = xmlReportFile + '/' + file; 
                if (file.endsWith('.xml')) {
                    core.info('Found a file which ends with .xml --> '+ file);
                    console.log('Parsing XML file path to prepare summaries payload: ' +filePath);
                    xmlData = fs.readFileSync(filePath, 'utf8');
                    xml2js.parseString(xmlData, (error, result) => {
                        if (error) {
                            throw error;
                        }
                        core.info('done forming result!!');
                        // 'result' is a JavaScript object
                        // convert it to a JSON string
                        jsonData = JSON.stringify(result, null, 4);
                        let parsedJson = JSON.parse(jsonData);
                        let parsedresponse = parsedJson["testsuites"];
                        core.info('parsedresponse is --> '+ JSON.stringify(parsedresponse));
                        let summaryObj = parsedresponse.testsuite[0].$;
                        packageName = summaryObj.name.replace(/\.[^.]*$/g,'');

                        let tests = parseInt(summaryObj.tests);
                        let failed = parseInt(summaryObj.failures);
                        let ignored = parseInt(summaryObj.errors);
                        let skipped = parseInt(summaryObj.skipped);
                        let duration = parseInt(summaryObj.time);
                        let passed = tests - (failed + ignored + skipped);

                        totalTests += tests;
                        passedTests += passed;
                        skippedTests += skipped;
                        ignoredTests += ignored;
                        failedTests += failed;
                        totalDuration += duration;
                    });
                }
            });
        } else {
            core.info('In else block, which means its a file directly');
            xmlData = fs.readFileSync(xmlReportFile, 'utf8');
            core.info('Successfully read xml data.');
            //convert xml to json
            xml2js.parseString(xmlData, (err, result) => {
                if (err) {
                    throw err;
                }
                // 'result' is a JavaScript object
                // convert it to a JSON string
                core.info('File converted from xml to json without any exception.');
                jsonData = JSON.stringify(result, null, 4);
                let parsedJson = JSON.parse(jsonData);
                core.info('We now have the parsed json.');
                // XUnit test format
                if (xmlData.includes('assemblies')){
                    core.info('XUnit test format:');
                    let parsedresponse = parsedJson["assemblies"];
                    passedTests = parseInt(parsedresponse.assembly[0].$.passed);
                    failedTests = parseInt(parsedresponse.assembly[0].$.failed);
                    skippedTests = parseInt(parsedresponse.assembly[0].$.skipped);
                    ignoredTests = 0;
                    totalTests = parseInt(parsedresponse.assembly[0].$.total);
                    startTime = parsedresponse.$.timestamp; 
                    startTime = startTime.replace(/ +\S*$/ig, 'Z');
                    endTime = parsedresponse.$.timestamp;//endTime.replace(/ +\S*$/ig, 'Z');
                    totalDuration = parseInt(parsedresponse.assembly[0].$.time);
                    testType = 'XUnit';
                }
                // NUnit test format
                else if(xmlData.includes('test-run')){
                    core.info('NUnit test format:');
                    let parsedresponse = parsedJson["test-run"]; 
                    core.info('NUnit test format: paresed json successfully');
                    passedTests = parseInt(parsedresponse.$.passed);
                    failedTests = parseInt(parsedresponse.$.failed);
                    skippedTests = parseInt(parsedresponse.$.skipped);
                    ignoredTests = 0;
                    totalTests = parseInt(parsedresponse.$.total);
                    startTime = parsedresponse.$["start-time"]; 
                    startTime = startTime.replace(/ +\S*$/ig, 'Z');
                    endTime = parsedresponse.$["end-time"];//endTime.replace(/ +\S*$/ig, 'Z');
                    totalDuration = parseInt(parsedresponse.$.duration);
                    testType = 'NUnit';
                }
                // UnitTest - MSTest
                else if(xmlData.includes('TestRun')){
                    core.info('MS tests - UnitTest:');
                    let parsedresponse = parsedJson["TestRun"]; 
                    passedTests = parseInt(parsedresponse.ResultSummary[0].Counters[0].$.passed);
                    failedTests = parseInt(parsedresponse.ResultSummary[0].Counters[0].$.failed);
                    skippedTests = 0;
                    ignoredTests = 0;
                    totalTests = parseInt(parsedresponse.ResultSummary[0].Counters[0].$.total);
                    startTime = parsedresponse.Times[0].$.start; 
                    startTime = startTime.replace(/ +\S*$/ig, 'Z');
                    endTime = parsedresponse.Times[0].$.finish;//endTime.replace(/ +\S*$/ig, 'Z');
                    totalDuration = 0;//calculate somehow later. parseInt(parsedresponse.$.duration);
                    testType = 'UnitTest';

                }
                // TestNG test format
                else if(xmlData.includes('testng-results')){
                    core.info('TestNG test format:');
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
            testType: testType,//'JUnit',
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
            xmlContent: xmlData,
            testType: testType
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
        if (e.message.includes('ECONNREFUSED') || e.message.includes('ENOTFOUND') || e.message.includes('405')) {
            core.setFailed('ServiceNow Instance URL is NOT valid. Please correct the URL and try again.');
        } else if (e.message.includes('401')) {
            core.setFailed('Invalid Credentials. Please correct the credentials and try again.');
        } else {
            core.setFailed(`ServiceNow Test Results are NOT created. Please check ServiceNow logs for more details.`);
        }
    }
    
})();
