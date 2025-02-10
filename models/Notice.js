const mongoose = require('mongoose');

// Enum for Notice Priority
const NoticePriority = {
    LOW: 'LOW',
    NORMAL: 'NORMAL',
    HIGH: 'HIGH',
    URGENT: 'URGENT'
};

// Enum for Notice Category
const NoticeCategory = {
    ACADEMIC: 'ACADEMIC',
    EXTRACURRICULAR: 'EXTRACURRICULAR',
    ADMINISTRATIVE: 'ADMINISTRATIVE',
    SPORTS: 'SPORTS',
    CULTURAL: 'CULTURAL',
    EXAM: 'EXAM',
    HOLIDAY: 'HOLIDAY',
    GENERAL: 'GENERAL'
};

// Enum for Notice Status
const NoticeStatus = {
    DRAFT: 'DRAFT',
    ACTIVE: 'ACTIVE',
    ARCHIVED: 'ARCHIVED',
    CANCELLED: 'CANCELLED'
};

// Notice Info Schema
const noticeInfoSchema = new mongoose.Schema({
    organisationName: {
        type: String,
        required: true
    },
    organisationAddress: {
        type: String,
        required: true
    },
    noticeDetails: {
        type: [String],
        required: true
    },
    noticeType: {
        type: String,
        enum: Object.values(NoticeCategory),
        required: true
    },
    department: {
        type: String,
        required: false
    }
});

// Notice Audience Schema
const noticeAudienceSchema = new mongoose.Schema({
    grades: {
        type: [String],
        default: []
    },
    sections: {
        type: [String],
        default: []
    },
    specificStudents: {
        type: [String],
        default: []
    },
    isSchoolWide: {
        type: Boolean,
        default: false
    }
});

// Notice Attachment Schema
const noticeAttachmentSchema = new mongoose.Schema({
    id: {
        type: String,
        required: true
    },
    fileName: {
        type: String,
        required: true
    },
    fileType: {
        type: String,
        required: true
    },
    fileUrl: {
        type: String,
        required: true
    },
    fileSize: {
        type: Number,
        required: true
    }
});

// Event Schedule Schema
const eventScheduleSchema = new mongoose.Schema({
    dateCreated: {
        type: String,  // Store as ISO date string: YYYY-MM-DD
        required: true,
        default: () => new Date().toISOString().split('T')[0]
    },
    timeCreated: {
        type: String,  // Store as 24-hour time string: HH:mm:ss
        required: true,
        default: () => new Date().toTimeString().split(' ')[0]
    },
    dateFromStart: {
        type: String,  // Store as ISO date string: YYYY-MM-DD
        required: true
    },
    dateToEnd: {
        type: String,  // Store as ISO date string: YYYY-MM-DD
        required: true
    },
    reminderDates: {
        type: [String],  // Array of ISO date strings
        default: []
    }
});

// Main Notice Schema
const noticeSchema = new mongoose.Schema({
    id: {
        type: String,
        required: false,
        unique: true
    },
    title: {
        type: String,
        required: true
    },
    noticeInfo: {
        type: noticeInfoSchema,
        required: true
    },
    eventSchedule: {
        type: eventScheduleSchema,
        required: true
    },
    audience: {
        type: noticeAudienceSchema,
        required: true
    },
    priority: {
        type: String,
        enum: Object.values(NoticePriority),
        default: NoticePriority.NORMAL
    },
    attachments: {
        type: [noticeAttachmentSchema],
        default: []
    },
    status: {
        type: String,
        enum: Object.values(NoticeStatus),
        default: NoticeStatus.ACTIVE
    }
});

// Pre-save middleware to update date and time
noticeSchema.pre('save', function(next) {
    // Automatically update dateCreated and timeCreated
    if (this.isModified()) {
        this.eventSchedule.dateCreated = new Date().toISOString().split('T')[0];
        this.eventSchedule.timeCreated = new Date().toTimeString().split(' ')[0];
    }
    
    // Ensure id is set
    if (!this.id && this._id) {
        this.id = this._id.toString();
    }

    next();
});

// Method to get safe ID
noticeSchema.methods.getSafeId = function() {
    return this.id || this._id.toString();
};

// Utility methods for date handling
noticeSchema.methods.formatDate = function(dateString) {
    return new Date(dateString).toISOString().split('T')[0];
};

module.exports = {
    Notice: mongoose.model('Notice', noticeSchema),
    NoticePriority,
    NoticeCategory,
    NoticeStatus
};
