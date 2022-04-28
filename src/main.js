const core = require('@actions/core');
const fs = require('fs');
const xml2js = require('xml2js');
const axios = require('axios');

(async function main() {
    const instanceName = core.getInput('instance-name', { required: true });
    const toolId = core.getInput('tool-id', { required: true });
    const username = core.getInput('devops-integration-user-name', { required: true });
    const password = core.getInput('devops-integration-user-password', { required: true });
    const jobname = core.getInput('job-name', { required: true });
    const xmlReportFile = core.getInput('xml-report-filename', { required: true });
    
    let xmlData;

    if (!!core.getInput('xml-report-filename')) {
        try {
            xmlData = fs.readFileSync(xmlReportFile, 'utf8');
        } catch (e) {
            core.setFailed(`Exception reading JUnit XML Report File Content ${e}`);
            return;
        }
    }

    let jsonData;
    let testSummaries;

    try {
        //convert xml to json
        xml2js.parseString(xmlData, (err, result) => {
            if(err) {
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
            let name = package.name.replace(/\.[^.]*$/g,'');

            testSummaries = [{
                name: name,
                passedTests: parseInt(summaryObj.passed),
                failedTests: parseInt(summaryObj.failed),
                skippedTests: parseInt(summaryObj.skipped),
                ignoredTests: parseInt(summaryObj.ignored),
                blockedTests: 0,
                totalTests: parseInt(summaryObj.total),
                startTime: startTime.replace(/ +\S*$/ig, 'Z'),
                endTime: endTime.replace(/ +\S*$/ig, 'Z'),
                duration: parseInt(suiteObj["duration-ms"]),
                testType: 'JUnit',
                suites: []			
            }];
            console.log("test summaries payload is : ", JSON.stringify(testSummaries));
        });
    } catch (e) {
        core.setFailed(`Exception parsing and converting xml to json ${e}`);
        return;
    }

    let githubContext = core.getInput('context-github', { required: true });

    try {
        githubContext = JSON.parse(githubContext);
    } catch (e) {
        core.setFailed(`Exception parsing github context ${e}`);
        return;
    }

    const endpoint = `https://${instanceName}.service-now.com/api/sn_devops/devops/tool/test?toolId=${toolId}&testType=JUnit`;

    let payload;
    
    try {
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
        core.setFailed(`Exception POSTing event payload to ServiceNow: ${e}\n\n${JSON.stringify(payload)}\n\n${e.toJSON}`);
    }
    
})();
