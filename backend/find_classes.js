const fs = require('fs');
const code = fs.readFileSync('../index-formatted.js', 'utf8');
const lines = code.split('\n');

// Find the U object that has profilePanel, navigateTab etc
lines.forEach((line, i) => {
  if ((line.includes('profilePanel') || line.includes('navigateTab') || 
       line.includes('profileTabs') || line.includes('profileOther') ||
       line.includes('profileRight') || line.includes('profileLeft')) && 
      line.includes('_')) {
    console.log(`Line ${i+1}: ${line.trim().substring(0, 150)}`);
  }
});
process.exit(0);
