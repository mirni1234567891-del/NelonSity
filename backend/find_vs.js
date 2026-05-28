const fs = require('fs');
const code = fs.readFileSync('../index-formatted.js', 'utf8');

// Find all occurrences of Vs
const regex = /\bVs\b/g;
let match;
const positions = [];
while ((match = regex.exec(code)) !== null) {
  positions.push(match.index);
}
console.log('Total Vs occurrences:', positions.length);

// Find the one that looks like a component definition
for (const pos of positions) {
  const snippet = code.substring(pos - 10, pos + 200);
  if (snippet.includes('=>') || snippet.includes('function') || snippet.includes('useState')) {
    console.log('\n--- Found at pos', pos, '---');
    console.log(snippet);
    console.log('---');
    break;
  }
}
process.exit(0);
