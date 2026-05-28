const bcrypt = require('bcryptjs');

const hash = '$2a$10$LranxhpWuepYV5GnhQwxbO4KQSCt8Yot.3QMqdRWCRO5824A4viD.';
const plain = 'dedok_666';

bcrypt.compare(plain, hash).then(result => {
  console.log('bcrypt.compare result:', result);
  process.exit(0);
});
