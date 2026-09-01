const fs = require('fs');

const issueBody = process.env.ISSUE_BODY || '';

const urlMatch = issueBody.match(/https:\/\/github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)/);

let repoUrl = '';
let branch = 'main';

if (urlMatch) {
  repoUrl = urlMatch[0].replace(/\.git$/, '');
}

const branchMatch = issueBody.match(/### اسم الفرع \(Branch\)\s+([^\r\n]+)/);
if (branchMatch) {
  let branchName = branchMatch[1].trim();
  if (branchName && branchName !== 'No response' && branchName !== 'No Response') {
    branch = branchName;
  }
}

console.log(`REPO_URL=${repoUrl}`);
console.log(`BRANCH=${branch}`);

if (process.env.GITHUB_ENV) {
  fs.appendFileSync(process.env.GITHUB_ENV, `TARGET_REPO_URL=${repoUrl}\n`);
  fs.appendFileSync(process.env.GITHUB_ENV, `TARGET_BRANCH=${branch}\n`);
}
