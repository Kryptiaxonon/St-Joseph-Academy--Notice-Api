const mongoose = require('mongoose');

const ReportInfoSchema = new mongoose.Schema({
    dateCreated: {
        type: String,
        required: true,
        validate: {
            validator: function(v) {
                return /^\d{4}-\d{2}-\d{2}$/.test(v);
            },
            message: 'Invalid date format (YYYY-MM-DD)'
        }
    },
    timeCreated: {
        type: String,
        required: true,
        validate: {
            validator: function(v) {
                return /^([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/.test(v);
            },
            message: 'Invalid time format (HH:mm:ss)'
        }
    },
    reportDetails: {
        type: String,
        required: true,
        trim: true,
        maxLength: 5000
    },
    type: {
        type: String,
        enum: ['TEXT', 'MEDIA', 'MIXED'],
        default: 'TEXT',
        required: true
    }
});

const ReportSchema = new mongoose.Schema({
    id: {
        type: String,
        required: false,
        unique: true,
        sparse: true
    },
    title: {
        type: String,
        required: true,
        trim: true,
        maxLength: 255,
        index: true
    },
    reportInfo: {
        type: ReportInfoSchema,
        required: true
    }
   /*
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    media: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Media',
        validate: {
            validator: function(mediaArray) {
                const reportType = this.reportInfo?.type;
                return !(reportType === 'MEDIA' || reportType === 'MIXED') || mediaArray.length > 0;
            },
            message: 'Media is required when report type is MEDIA or MIXED'
        }
    }]
    */
}, {
    timestamps: false
});

// Add compound index for date-based queries
ReportSchema.index({ 'reportInfo.dateCreated': 1, 'reportInfo.type': 1 });

ReportSchema.pre('save', function(next) {
    const now = new Date();
    if (!this.reportInfo.dateCreated) {
        this.reportInfo.dateCreated = now.toISOString().split('T')[0];
    }
    if (!this.reportInfo.timeCreated) {
        this.reportInfo.timeCreated = now.toTimeString().split(' ')[0];
    }
    next();
});

module.exports = mongoose.model('Report', ReportSchema);

