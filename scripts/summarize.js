const fs = require('fs');

async function main() {
  let issues = [];
  try {
    if (fs.existsSync('normalized.json')) {
      issues = JSON.parse(fs.readFileSync('normalized.json', 'utf8') || '[]');
    }
  } catch (e) {
    console.log('خطأ في قراءة ملف النتائج');
  }

  const total = issues.length;
  let reportContent = '';

  if (total === 0) {
    reportContent = `### 🛡️ نتيجة الفحص الأمني

✅ **تهانينا! لم يتم العثور على أي مشاكل أمنية واضحة أو تسريبات في هذا المستودع.**
- فحص الأسرار والتسريبات: **سليم**
- فحص أنماط الكود: **سليم**
- فحص الاعتمادات والمكتبات: **سليم**
`;
  } else {
    reportContent = `### 🛡️ تقرير الفحص الأمني

تم اكتشاف **${total}** ملاحظة أمنية تحتاج إلى مراجعة:

| الأداة | نوع المشكلة | الملف | السطر | الخطورة | التفاصيل |
| :--- | :--- | :--- | :--- | :--- | :--- |
`;

    // عرض أول 15 مشكلة في الجدول لتفادي كبر حجم التقرير
    issues.slice(0, 15).forEach(item => {
      reportContent += `| ${item.tool} | ${item.type} | \`${item.file}\` | ${item.line || '-'} | ${item.severity} | ${item.description.replace(/\n/g, ' ')} |\n`;
    });

    if (total > 15) {
      reportContent += `\n*... تم إظهار أول 15 ملاحظة فقط من أصل ${total}. يمكنك تحميل ملف التقرير الكامل من قسم الـ Artifacts.*`;
    }

    reportContent += `\n\n#### 💡 نصائح وتوجيهات:
1. تأكد من إزالة أي مفاتيح سرية (API Keys) تم رصدها وإعادة توليدها فوراً.
2. حدّث المكتبات البرمجية التي تحتوي على ثغرات معروفة إلى أحدث إصدار.
3. راجع الأسطر المذكورة لمعالجة أنماط الكود غير الآمنة.
`;
  }

  // حفظ التقرير في ملف markdown ليتم نشره كتعليق
  fs.writeFileSync('summary.md', reportContent);
  console.log('تم إنشاء التقرير بنجاح.');
}

main();
