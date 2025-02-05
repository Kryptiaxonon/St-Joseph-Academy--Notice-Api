const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true,
    trim: true
  },
  admissionNo: { 
    type: String, 
    required: true, 
    unique: true,
    trim: true
  },
  password: { 
    type: String, 
    required: true,
    select: false
  },
  phone: { 
    type: String, 
    required: true,
    trim: true
  },
  otp: {
    type: String,
    required: false,
    unique: true
  },
  otpExpiry: {
    type: String,
    required: false,
    default: () => new Date().toISOString().split('T')[0]
  },
  refreshTokens: [{
    type: String
  }],
  createdAt: {
    type: String, // Store as ISO date string: YYYY-MM-DD
    required: true,
    default: () => new Date().toISOString().split('T')[0]
  },
  updatedAt: {
    type: String, // Store as ISO date string: YYYY-MM-DD
    required: true,
    default: () => new Date().toISOString().split('T')[0]
  }
});

// Remove timestamps option since we're handling dates manually
UserSchema.pre('save', function(next) {
  this.updatedAt = new Date().toISOString().split('T')[0];
  next();
});

module.exports = mongoose.model('User', UserSchema);

