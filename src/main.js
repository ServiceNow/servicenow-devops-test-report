const core = require('@actions/core');
const fs = require('fs');
const xml2js = require('xml2js');
const axios = require('axios');

(async function main() {
    let instanceUrl = core.getInput('instance-url', { required: true });
    const toolId = core.getInput('tool-id', { required: true });
    const username = core.getInput('devops-integration-user-name', { required: true });
    const password = core.getInput('devops-integration-user-password', { required: true });
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
                let filePath = xmlReportFile + file;
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
                        let parsedresponse = parsedJson["testsuite"];
                        let summaryObj = parsedresponse.$;
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
    const endpoint = `${instanceUrl}/api/sn_devops/devops/tool/test?toolId=${toolId}&testType=JUnit`;

    try {
        const token = `${username}:${password}`;
        const encodedToken = Buffer.from(token).toString('base64');

        const defaultHeaders = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': 'Basic ' + `${encodedToken}`
        };
        
        let httpHeaders = { headers: defaultHeaders };
        result = await axios.post(endpoint, JSON.stringify(payload), httpHeaders);
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
