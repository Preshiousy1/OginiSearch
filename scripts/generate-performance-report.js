import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read performance test results
const resultsPath = path.join(__dirname, '../performance-results/results.json');

if (!fs.existsSync(resultsPath)) {
  console.error('❌ Performance results file not found. Run tests first.');
  process.exit(1);
}

const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));

// Generate HTML report
const generateHtmlReport = results => {
  if (!results || !results.testResults || results.testResults.length === 0) {
    return `
<!DOCTYPE html>
<html>
<head>
  <title>Ogini Performance Test Results</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    .error { color: red; }
  </style>
</head>
<body>
  <h1>Ogini Performance Test Results</h1>
  <div class="error">
    <h2>No test results available</h2>
    <p>The performance tests did not complete successfully.</p>
  </div>
</body>
</html>`;
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Ogini Performance Test Results</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    .test { margin-bottom: 20px; padding: 10px; border: 1px solid #ddd; }
    .passed { background-color: #e6ffe6; }
    .failed { background-color: #ffe6e6; }
    .metrics { margin-top: 10px; }
    .metric { margin: 5px 0; }
  </style>
</head>
<body>
  <h1>Ogini Performance Test Results</h1>
  <div class="summary">
    <h2>Summary</h2>
    <p>Total Tests: ${results.numTotalTests}</p>
    <p>Passed: ${results.numPassedTests}</p>
    <p>Failed: ${results.numFailedTests}</p>
  </div>
  <div class="tests">
    ${results.testResults
      .map(testResult => {
        const testName = testResult.testFilePath.split('/').pop();
        const status = testResult.numFailingTests === 0 ? 'passed' : 'failed';
        return `
      <div class="test ${status}">
        <h3>${testName}</h3>
        <div class="metrics">
          ${testResult.testResults
            .map(test => {
              const metrics = test.performanceMetrics || {};
              return `
            <div class="metric">
              <strong>${test.title}</strong>
              <ul>
                ${Object.entries(metrics)
                  .map(([key, value]) => `<li>${key}: ${value}</li>`)
                  .join('')}
              </ul>
            </div>`;
            })
            .join('')}
        </div>
      </div>`;
      })
      .join('')}
  </div>
</body>
</html>`;

  return html;
};

// Generate markdown report
const generateMarkdownReport = results => {
  if (!results || !results.testResults || results.testResults.length === 0) {
    return `# Ogini Performance Test Results

## Error
No test results available. The performance tests did not complete successfully.`;
  }

  const markdown = `# Ogini Performance Test Results

## Summary
- Total Tests: ${results.numTotalTests}
- Passed: ${results.numPassedTests}
- Failed: ${results.numFailedTests}

## Test Results
${results.testResults
      .map(testResult => {
        const testName = testResult.testFilePath.split('/').pop();
        const status = testResult.numFailingTests === 0 ? '✅' : '❌';
        return `
### ${status} ${testName}

${testResult.testResults
            .map(test => {
              const metrics = test.performanceMetrics || {};
              return `
#### ${test.title}
${Object.entries(metrics)
                  .map(([key, value]) => `- ${key}: ${value}`)
                  .join('\n')}`;
            })
            .join('\n')}`;
      })
      .join('\n')}`;

  return markdown;
};

// Save reports
const saveReports = () => {
  const htmlReport = generateHtmlReport(results);
  const markdownReport = generateMarkdownReport(results);

  const reportsDir = path.join(__dirname, '../performance-results');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  fs.writeFileSync(path.join(reportsDir, 'report.html'), htmlReport);
  fs.writeFileSync(path.join(reportsDir, 'report.md'), markdownReport);
};

// Generate and save reports
try {
  saveReports();
  console.log('✅ Performance reports generated successfully');
} catch (error) {
  console.error('❌ Failed to generate performance reports:', error.message);
  process.exit(1);
}
