const mongoose = require('mongoose');

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
        type: String,
        required: true
    },
    noticeType: {
        type: String,
        required: true
    }
});

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
    dateUpdated: {
        type: String,  // Store as ISO date string: YYYY-MM-DD
        required: false,
        default: () => new Date().toISOString().split('T')[0]
    },
    timeUpdated: {
        type: String,  // Store as 24-hour time string: HH:mm:ss
        required: false,
        default: () => new Date().toTimeString().split(' ')[0]
    },
    dateFromStart: {
        type: String,  // Store as ISO date string: YYYY-MM-DD
        required: true
    },
    dateToEnd: {
        type: String,  // Store as ISO date string: YYYY-MM-DD
        required: true
    }
});

const noticeSchema = new mongoose.Schema({
    id: {
	type: String,
        required: false,
        unique: true,
        sparse: true
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
    }
});

// Add pre-save middleware to update dateUpdated and timeUpdated
noticeSchema.pre('save', function(next) {
    if (this.isModified()) {
        this.eventSchedule.dateUpdated = new Date().toISOString().split('T')[0];
        this.eventSchedule.timeUpdated = new Date().toTimeString().split(' ')[0];
    }
    if (!this.id && this._id) {
        this.id = this._id.toString();
    }

    next();
});

noticeSchema.methods.getSafeId = function() {
    return this.id || this._id.toString();
};

module.exports = mongoose.model('Notice', noticeSchema);
