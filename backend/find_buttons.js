const fs = require('fs');
const code = fs.readFileSync('../index-formatted.js', 'utf8');

// Find lines containing Products, Roulette, Friends, Prefixes as string literals
const lines = code.split('\n');
lines.forEach((line, i) => {
  if (line.includes("'Products'") || line.includes('"Products"') || line.includes('`Products`') ||
      line.includes("'Roulette'") || line.includes('"Roulette"') || line.includes('`Roulette`') ||
      line.includes("'Friends'") || line.includes('"Friends"') || line.includes('`Friends`') ||
      line.includes("'Prefixes'") || line.includes('"Prefixes"') || line.includes('`Prefixes`')) {
    console.log(`Line ${i+1}: ${line.trim().substring(0, 120)}`);
  }
});
process.exit(0);
