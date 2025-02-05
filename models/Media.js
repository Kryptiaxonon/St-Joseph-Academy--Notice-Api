const mongoose = require('mongoose');

const MediaSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true,
        maxLength: 255
    },
    type: {
        type: String,
        enum: ['IMAGE', 'VIDEO'],
        required: true
    },
    url: {
        type: String,
        required: true,
        trim: true,
        validate: {
            validator: function(v) {
                return /^\/uploads\/[a-zA-Z0-9-_.]+$/.test(v);
            },
            message: 'Invalid URL format'
        }
    },
    thumbnailUrl: {
        type: String,
        default: null,
        trim: true,
        validate: {
            validator: function(v) {
                return !v || /^\/uploads\/[a-zA-Z0-9-_.]+$/.test(v);
            },
            message: 'Invalid thumbnail URL format'
        }
    },
    size: {
        type: Number,
        required: true,
        min: 0,
        max: 100 * 1024 * 1024 // 100MB
    },
    dateUploaded: {
        type: String,
        required: true,
        validate: {
            validator: function(v) {
                return /^\d{4}-\d{2}-\d{2}$/.test(v);
            },
            message: 'Invalid date format (YYYY-MM-DD)'
        }
    },
    timeUploaded: {
        type: String,
        required: true,
        validate: {
            validator: function(v) {
                return /^([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/.test(v);
            },
            message: 'Invalid time format (HH:mm:ss)'
        }
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    }
}, {
    timestamps: false
});

// Add indexes for common queries
MediaSchema.index({ dateUploaded: 1 });
MediaSchema.index({ type: 1 });

MediaSchema.pre('save', function(next) {
    const now = new Date();
    if (!this.dateUploaded) {
        this.dateUploaded = now.toISOString().split('T')[0];
    }
    if (!this.timeUploaded) {
        this.timeUploaded = now.toTimeString().split(' ')[0];
    }
    next();
});

module.exports = mongoose.model('Media', MediaSchema);

