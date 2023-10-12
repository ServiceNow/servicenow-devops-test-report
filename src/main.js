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
    const testType = core.getInput('test-type', { required: true });
    
    let githubContext = core.getInput('context-github', { required: true });

    try {
        githubContext = JSON.parse(githubContext);
    } catch (e) {
        core.setFailed(`Exception parsing github context ${e}`);
        return;
    }

    let xmlData, testDataJSONStr, httpHeaders;
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
                        testDataJSONStr = JSON.stringify(result, null, 4);
                        let parsedJson = JSON.parse(testDataJSONStr);
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
                testDataJSONStr = JSON.stringify(result, null, 4);
                //core.info('testDataJSONStr is --> '+ testDataJSONStr);
            });
        }
        // Preparing headers and endpoint Urls
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
            restEndpointUploadFile = `${instanceUrl}/api/sn_devops/v2/devops/upload?toolId=${toolId}`;
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
            restEndpointUploadFile = `${instanceUrl}/api/sn_devops/v1/devops/upload?toolId=${toolId}`;
        } else {
            core.setFailed('For Basic Auth, Username and Password is mandatory for integration user authentication');
            return;
        }
       
        // API call to send test data as json to servicenow.
        let responseData;
        try{
            responseData = await axios.post(restEndpointUploadFile, testDataJSONStr, httpHeaders);
        }
        catch (error) {
            if (error.response) {
              core.info('Error Status:', error.response.status);
              core.info('Error Data:', JSON.stringify(error.response.data, null, 2));
            } else {
              core.info('Request failed:', error.message);
            }
          }

    } catch (e) {
        core.setFailed(`Exception parsing and converting xml to json ${e}`);
        return;
    }

    
    // let result;
    // let snowResponse;
    // const endpointV1 = `${instanceUrl}/api/sn_devops/v1/devops/tool/test?toolId=${toolId}&testType=JUnit`;
    // const endpointV2 = `${instanceUrl}/api/sn_devops/v2/devops/tool/test?toolId=${toolId}&testType=JUnit`;

    try {
        core.info('hit test api now');
        
        //snowResponse = await axios.post(endpoint, JSON.stringify(payload), httpHeaders);
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
