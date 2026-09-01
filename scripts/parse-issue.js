const fs = require('fs');

const issueBody = process.env.ISSUE_BODY || '';

// استخراج رابط المستودع من نص الطلب
const urlMatch = issueBody.match(/https:\/\/github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)/);

let repoUrl = '';
let branch = 'main';

if (urlMatch) {
// استخراج اسم الفرع إذا وجد
const branchMatch = issueBody.match(/### اسم الفرع \(Branch\)\s+([^\r\n]+)/);
if (branchMatch) {
  let branchName = branchMatch[1].trim();
  if (
    branchName &&
    branchName !== 'No response' &&
    branchName !== 'No Response' &&
    branchName.toLowerCase() !== 'no response'
  ) {
    branch = branchName;
  } else {
    branch = 'main';
  }
} else {
  branch = 'main';
}
}

console.log(`REPO_URL=${repoUrl}`);
console.log(`BRANCH=${branch}`);

// حفظ القيم للمراحل القادمة
if (process.env.GITHUB_ENV) {
  fs.appendFileSync(process.env.GITHUB_ENV, `TARGET_REPO_URL=${repoUrl}\n`);
  fs.appendFileSync(process.env.GITHUB_ENV, `TARGET_BRANCH=${branch}\n`);
}
