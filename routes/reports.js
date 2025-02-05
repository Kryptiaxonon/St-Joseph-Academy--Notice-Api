const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Report = require('../models/Report');
const Media = require('../models/Media');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const mongoose = require('mongoose');

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || "St-Joseph-Academy";

const getCurrentDateTime = () => {
    const now = new Date();
    return {
        date: now.toISOString().split('T')[0],
        time: now.toTimeString().split(' ')[0]
    };
};

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'video/mp4'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type'));
        }
    }
});

const createResponse = (success, type, message, data = null, error = null) => {
    return {
        success,
        type,
        message,
        data,
        ...(error && process.env.NODE_ENV === 'development' && { error })
    };
};

// Use consistently across all routes

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ').pop();

    if (!token) {
        return res.status(401).json(createResponse(
            false,
            "Error",
            'Access token is required'
        ));
    }

    try {
        const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET);
        req.userId = decoded.id;
        next();
    } catch (error) {
        return res.status(403).json(createResponse(
            false,
            "Error",
            'Invalid or expired token',
            null,
            process.env.NODE_ENV === 'development' ? error.message : undefined
        ));
    }
};

// Get all reports
router.get('/', authenticateToken, async (req, res) => {
    try {
        const reports = await Report.find()
            .populate('user', 'name admissionNo')
            .populate('media')
            .sort({ 'reportInfo.dateCreated': -1 });
        
        if (!reports || reports.length === 0) {
            return res.status(404).json(createResponse(
                false,
                "Error",
                'No reports found'
            ));
        }

        const transformedReports = reports.map(report => ({
            ...report.toObject(),
            id: report._id.toString()
        }));

        return res.status(200).json(createResponse(
            true,
            "Success",
            'Reports retrieved successfully',
            transformedReports
        ));
    } catch (error) {
        res.status(500).json(createResponse(
            false,
            "Error",
            'Error retrieving reports',
            null,
            error.message
        ));
    }
});

// Get single report
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json(createResponse(
                false,
                "Error",
                'Invalid report ID format'
            ));
        }

        const report = await Report.findById(id)
            .populate('user', 'name admissionNo')
            .populate('media');

        if (!report) {
            return res.status(404).json(createResponse(
                false,
                "Error",
                'Report not found'
            ));
        }

        const reportObject = report.toObject();
        reportObject.id = reportObject._id.toString();

        return res.status(200).json(createResponse(
            true,
            "Success",
            'Report retrieved successfully',
            reportObject
        ));
    } catch (error) {
        res.status(500).json(createResponse(
            false,
            "Error",
            'Error retrieving report',
            null,
            error.message
        ));
    }
});

// Create new report
router.post('/create', authenticateToken, async (req, res) => {
    const session = await mongoose.startSession();
    try {
        await session.startTransaction();

        //const { title, reportInfo, mediaIds } = req.body;
        const { title, reportInfo} = req.body;
        // Validate media
        /*if (mediaIds?.length > 0) {
            const validMediaIds = await Media.find({
                _id: { $in: mediaIds },
                user: req.userId
            }).session(session);

            if (validMediaIds.length !== mediaIds.length) {
                throw new Error('Invalid media IDs');
            }
        }*/

        const { date, time } = getCurrentDateTime();
        const newReport = await Report.create([{
            title,
            reportInfo: {
                ...reportInfo,
                dateCreated: date,
                timeCreated: time
            },
            user: req.userId,
            media: mediaIds || []
        }], { session });

        await session.commitTransaction();
        
        const populatedReport = await Report.findById(newReport[0]._id)
           // .populate('user', 'name admissionNo')
           // .populate('media');

        res.status(201).json(createResponse(
            true,
            "Success",
            'Report created successfully',
            populatedReport
        ));
    } catch (error) {
        await session.abortTransaction();
        res.status(500).json(createResponse(
            false,
            "Error",
            'Error creating report',
            null,
            error.message
        ));
    } finally {
        //session.endSession();
    }
});

// Filter reports
router.get('/filter', authenticateToken, async (req, res) => {
    try {
        const { 
            startDate, 
            endDate, 
            type,
            searchQuery 
        } = req.query;

        let filter = { user: req.userId };

        if (startDate && endDate) {
            filter['reportInfo.dateCreated'] = { 
                $gte: startDate,
                $lte: endDate 
            };
        }

        if (type) {
            filter['reportInfo.type'] = type;
        }

        if (searchQuery) {
            filter.$or = [
                { title: { $regex: new RegExp(searchQuery, 'i') } },
                { 'reportInfo.reportDetails': { $regex: new RegExp(searchQuery, 'i') } }
            ];
        }

        const reports = await Report.find(filter)
            .populate('user', 'name admissionNo')
            .populate('media')
            .sort({ 'reportInfo.dateCreated': -1 });

        if (!reports || reports.length === 0) {
            return res.status(404).json(createResponse(
                false,
                "Error",
                'No reports found matching the filter criteria'
            ));
        }

        const transformedReports = reports.map(report => ({
            ...report.toObject(),
            id: report._id.toString()
        }));

        return res.status(200).json(createResponse(
            true,
            "Success",
            'Filtered reports retrieved successfully',
            transformedReports
        ));
    } catch (error) {
        res.status(500).json(createResponse(
            false,
            "Error",
            'Error filtering reports',
            null,
            error.message
        ));
    }
});

router.post('/sync-local', authenticateToken, async (req, res) => {
    try {
        const { reports } = req.body;

        if (!reports || reports.length === 0) {
            return res.status(404).json(createResponse(
                false,
                "Error",
                'No reports found to sync'
            ));
        }

        const results = {
            success: [],
            failed: []
        };

        for (const report of reports) {
            try {
                // Check if report already exists
                const existingReport = await Report.findOne({
                    $and: [
                        { title: report.title },
                        { 'reportInfo.dateCreated': report.reportInfo.dateCreated },
                        { 'reportInfo.timeCreated': report.reportInfo.timeCreated }
                    ]
                });

                if (existingReport) {
                    results.success.push({
                        id: existingReport._id.toString(),
                        status: 'skipped',
                        message: 'Report already exists'
                    });
                    continue;
                }

                // Create new report
                const newReport = new Report(report);
                const saved = await newReport.save();
                
                results.success.push({
                    id: saved._id.toString(),
                    status: 'created',
                    message: 'New report created'
                });
            } catch (error) {
                results.failed.push({
                    report: report.title,
                    error: error.message
                });
            }
        }

        res.status(200).json(createResponse(
            true,
            "Success",
            'Local reports synced with server',
            { 
                success: results.success, 
                failed: results.failed,
                summary: {
                    total: reports.length,
                    created: results.success.filter(r => r.status === 'created').length,
                    skipped: results.success.filter(r => r.status === 'skipped').length,
                    failed: results.failed.length
                }
            }
        ));
    } catch (error) {
        res.status(500).json(createResponse(
            false,
            "Error",
            'Error syncing local reports with server',
            null,
            error.message
        ));
    }
});

// Update local reports
router.post('/update-local', authenticateToken, async (req, res) => {
    try {
        const reports = await Report.find()
            .sort({ 'reportInfo.dateCreated': -1 })
            .populate('user', 'name admissionNo')
            .populate('media');
        
        if (!reports || reports.length === 0) {
            return res.status(404).json(createResponse(
                false,
                "Error",
                'No reports to update in local storage'
            ));
        }

        // Write reports to local JSON file
        await fs.writeFile(LOCAL_REPORTS_PATH, JSON.stringify({ reports }, null, 2));

        res.status(200).json(createResponse(
            true,
            "Success",
            'Local reports updated successfully',
            reports
        ));
    } catch (error) {
        res.status(500).json(createResponse(
            false,
            "Error",
            'Error updating local reports',
            null,
            error.message
        ));
    }
});

router.put('/update-reports/:id', upload.array('media', 10), async (req, res) => {
    try {
        const report = await Report.findById(req.params.id);
        if (!report) {
            return res.status(404).json({ error: 'Report not found' });
        }

        // Handle new media files
        const files = req.files || [];
        const newMediaEntries = await Promise.all(files.map(async file => {
            const mediaType = file.mimetype.startsWith('image/') ? 'IMAGE' : 'VIDEO';
            
            const media = new Media({
                title: file.originalname,
                type: mediaType,
                url: `/uploads/${file.filename}`,
                size: file.size,
                dateUploaded: new Date().toISOString().split('T')[0],
                timeUploaded: new Date().toTimeString().split(' ')[0],
                user: req.user.id
            });
            
            return await media.save();
        }));

        // Update report fields
        const { title, reportDetails, type } = req.body;
        const updatedReport = await Report.findByIdAndUpdate(
            req.params.id,
            {
                title,
                'reportInfo.reportDetails': reportDetails,
                'reportInfo.type': newMediaEntries.length > 0 ? (type || 'MIXED') : 'TEXT',
                $push: { media: { $each: newMediaEntries.map(media => media._id) } }
            },
            { new: true }
        ).populate('user', 'name admissionNo').populate('media');

        res.json(updatedReport);
    } catch (error) {
        // Clean up uploaded files if update fails
        if (req.files) {
            await Promise.all(req.files.map(file => 
                fs.unlink(file.path).catch(() => {})
            ));
        }
        res.status(400).json({ error: error.message });
    }
});

// Delete a report
router.delete('/reports/:id', async (req, res) => {
    try {
        const report = await Report.findById(req.params.id).populate('media');
        if (!report) {
            return res.status(404).json({ error: 'Report not found' });
        }

        // Delete associated media files
        await Promise.all(report.media.map(async media => {
            try {
                await fs.unlink(path.join('uploads', path.basename(media.url)));
                if (media.thumbnailUrl) {
                    await fs.unlink(path.join('uploads', path.basename(media.thumbnailUrl)));
                }
                await Media.findByIdAndDelete(media._id);
            } catch (err) {
                console.error(`Error deleting media ${media._id}:`, err);
            }
        }));

        await Report.findByIdAndDelete(req.params.id);
        res.json({ message: 'Report deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete specific media from a report
router.delete('/:reportId/media/:mediaId', async (req, res) => {
    try {
        const report = await Report.findById(req.params.reportId);
        if (!report) {
            return res.status(404).json({ error: 'Report not found' });
        }

        const media = await Media.findById(req.params.mediaId);
        if (!media) {
            return res.status(404).json({ error: 'Media not found' });
        }

        // Delete the media file
        try {
            await fs.unlink(path.join('uploads', path.basename(media.url)));
            if (media.thumbnailUrl) {
                await fs.unlink(path.join('uploads', path.basename(media.thumbnailUrl)));
            }
        } catch (err) {
            console.error('Error deleting media file:', err);
        }

        // Remove media reference from report and delete media document
        await Report.findByIdAndUpdate(req.params.reportId, {
            $pull: { media: req.params.mediaId }
        });
        await Media.findByIdAndDelete(req.params.mediaId);

        // Update report type if necessary
        const updatedReport = await Report.findById(req.params.reportId).populate('media');
        if (updatedReport.media.length === 0) {
            updatedReport.reportInfo.type = 'TEXT';
            await updatedReport.save();
        }

        res.json(updatedReport);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


module.exports = router;
