const fs = require('fs');
const code = fs.readFileSync('../index-formatted.js', 'utf8');
const lines = code.split('\n');

lines.forEach((line, i) => {
  if (line.includes('infoSubscription') || line.includes('subtill')) {
    console.log(`Line ${i+1}: ${line.trim().substring(0, 150)}`);
  }
});
process.exit(0);
