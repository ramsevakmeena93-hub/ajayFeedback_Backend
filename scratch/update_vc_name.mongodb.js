// MongoDB shell script to update VC name
// Run this in MongoDB Compass or mongosh

use('feedback_system'); // Replace with your database name

// Update VC user name
const result = db.users.updateOne(
  { role: 'vc' },
  { 
    $set: { 
      name: 'Dr. Manjuree Pandit'
    } 
  }
);

print('Update result:', JSON.stringify(result));

// Check the updated user
const vcUser = db.users.findOne({ role: 'vc' }, { name: 1, email: 1, role: 1 });
print('Updated VC user:', JSON.stringify(vcUser));
