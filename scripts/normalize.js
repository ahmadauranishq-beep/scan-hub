const fs = require('fs');

const results = [];

// 1. قراءة نتائج Gitleaks (فحص الأسرار والتسريبات)
try {
  if (fs.existsSync('gitleaks.json')) {
    const gitleaksData = JSON.parse(fs.readFileSync('gitleaks.json', 'utf8') || '[]');
    gitleaksData.forEach(item => {
      results.push({
        tool: 'Gitleaks',
        type: 'تسريب أسرار (Secret Leak)',
        file: item.File || 'غير محدد',
        line: item.StartLine || 0,
        description: item.Description || item.RuleID || 'تم العثور على مفتاح أو كلمة مرور مكشوفة',
        severity: 'عالي (High)'
      });
    });
  }
} catch (e) {
  console.log('ملاحظة: تعذر قراءة تقرير Gitleaks أو لا توجد نتائج.');
}

// 2. قراءة نتائج Semgrep (فحص الثغرات في الكود)
try {
  if (fs.existsSync('semgrep.json')) {
    const semgrepData = JSON.parse(fs.readFileSync('semgrep.json', 'utf8') || '{}');
    if (semgrepData.results) {
      semgrepData.results.forEach(item => {
        results.push({
          tool: 'Semgrep',
          type: 'ثغرة برمجية (Code Flaw)',
          file: item.path || 'غير محدد',
          line: item.start?.line || 0,
          description: item.extra?.message || item.check_id || 'نمط كود غير آمن',
          severity: item.extra?.severity || 'متوسط (Medium)'
        });
      });
    }
  }
} catch (e) {
  console.log('ملاحظة: تعذر قراءة تقرير Semgrep أو لا توجد نتائج.');
}

// 3. قراءة نتائج Trivy (فحص المكتبات والاعتمادات)
try {
  if (fs.existsSync('trivy.json')) {
    const trivyData = JSON.parse(fs.readFileSync('trivy.json', 'utf8') || '{}');
    if (trivyData.Results) {
      trivyData.Results.forEach(target => {
        if (target.Vulnerabilities) {
          target.Vulnerabilities.forEach(vuln => {
            results.push({
              tool: 'Trivy',
              type: 'مكتبة غير آمنة (Vulnerable Dependency)',
              file: target.Target || 'حزمة البرمجيات',
              line: 0,
              description: `${vuln.PkgName} (${vuln.VulnerabilityID}) - ${vuln.Title || vuln.Description || ''}`.slice(0, 150),
              severity: vuln.Severity || 'غير محدد'
            });
          });
        }
      });
    }
  }
} catch (e) {
  console.log('ملاحظة: تعذر قراءة تقرير Trivy أو لا توجد نتائج.');
}

// حفظ النتائج الموحدة في ملف واحد
fs.writeFileSync('normalized.json', JSON.stringify(results, null, 2));
console.log(`تم تجميع ${results.length} ملاحظة أمنية بنجاح.`);
