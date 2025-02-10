const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const fs = require('fs').promises;
const mongoose = require('mongoose');
const path = require('path');
const { Notice, NoticePriority, NoticeCategory, NoticeStatus } = require('../models/Notice');
const { GridFSBucket } = require('mongodb');
const multer = require('multer');
const stream = require('stream');

// Path to local notices JSON
const LOCAL_NOTICES_PATH = path.join(__dirname, '..', 'local_notices.json');

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || "St-Joseph-Academy";

// Setup GridFS
let bucket;
mongoose.connection.once('open', () => {
    bucket = new GridFSBucket(mongoose.connection.db, {
        bucketName: 'attachments'
    });
});

// Setup multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });


// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ').pop();            
    console.log("Token: \n",token);
    if (!token) {
        return res.status(401).json(createResponse(
            false,
            "Error",
            'Access token is required'
        ));
    }

    try {                                                                                       const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET);
        req.userId = decoded.id;
	    next();
    } catch (error) {                                                                           console.error('Token Verification Error:', error);
	    return res.status(403).json(createResponse(
            false,
            "Error",
            'Invalid or expired token',
            null,
            process.env.NODE_ENV === 'development' ? error.message : undefined
        ));
    }
};

// Validation middleware for notice details
const validateNoticeDetails = (req, res, next) => {
    const { noticeInfo } = req.body;
    
    if (!noticeInfo) {
        return res.status(400).json(createResponse(
            false,
            "Error",
            'Notice info is required'
        ));
    }

    // Ensure noticeDetails is an array
    if (noticeInfo.noticeDetails) {
        if (!Array.isArray(noticeInfo.noticeDetails)) {
            // If it's a string, convert it to an array with one element
            if (typeof noticeInfo.noticeDetails === 'string') {
                req.body.noticeInfo.noticeDetails = [noticeInfo.noticeDetails];
            } else {
                return res.status(400).json(createResponse(
                    false,
                    "Error",
                    'noticeDetails must be an array of strings'
                ));
            }
        }
        
        // Validate that all elements are strings
        if (!noticeInfo.noticeDetails.every(detail => typeof detail === 'string')) {
            return res.status(400).json(createResponse(
                false,
                "Error",
                'All notice details must be strings'
            ));
        }
    } else {
        // Initialize as empty array if not provided
        req.body.noticeInfo.noticeDetails = [];
    }

    next();
};

// Add new route to handle file uploads
router.post('/upload-attachment', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json(createResponse(
                false,
                "Error",
                'No file uploaded'
            ));
        }

        const fileId = new mongoose.Types.ObjectId();
        const uploadStream = bucket.openUploadStreamWithId(fileId, req.file.originalname);
        
        const bufferStream = new stream.PassThrough();
        bufferStream.end(req.file.buffer);
        
        await new Promise((resolve, reject) => {
            bufferStream.pipe(uploadStream)
                .on('error', reject)
                .on('finish', resolve);
        });

        const attachment = {
            id: fileId.toString(),
            fileName: req.file.originalname,
            fileType: req.file.mimetype,
            fileUrl: `/api/notices/attachment/${fileId}`,
            fileSize: req.file.size
        };

        res.status(200).json(createResponse(
            true,
            "Success",
            'File uploaded successfully',
            attachment
        ));
    } catch (error) {
        res.status(500).json(createResponse(
            false,
            "Error",
            'Error uploading file',
            null,
            error.message
        ));
    }
});

// Add route to serve files
router.get('/attachment/:id', authenticateToken, async (req, res) => {
    try {
        const fileId = new mongoose.Types.ObjectId(req.params.id);
        const downloadStream = bucket.openDownloadStream(fileId);
        
        downloadStream.on('error', () => {
            res.status(404).json(createResponse(
                false,
                "Error",
                'File not found'
            ));
        });

        // Set proper content type
        const file = await bucket.find({ _id: fileId }).next();
        if (file) {
            res.set('Content-Type', file.contentType);
        }

        downloadStream.pipe(res);
    } catch (error) {
        res.status(500).json(createResponse(
            false,
            "Error",
            'Error downloading file',
            null,
            error.message
        ));
    }
});

// Helper function to get current date and time in ISO format
const getCurrentDateTime = () => {
    const now = new Date();
    return {
        date: now.toISOString().split('T')[0],
        time: now.toTimeString().split(' ')[0]
    };
};

// Matches the Kotlin BaseApiResponse format
const createResponse = (success, type, message, data = null, error = null) => {
    return {
        success,
        type,
        message,
        data,
        ...(error && process.env.NODE_ENV === 'development' && { error })
    };
};

// Get all notices
router.get('/', authenticateToken, async (req, res) => {
    try {
        const notices = await Notice.find().sort({ 'eventSchedule.dateCreated': -1 });
        
        if (notices && notices.length > 0) {
            // Transform to use _id as id
            const transformedNotices = notices.map(notice => {
                const noticeObj = notice.toObject();
                return {
                    ...noticeObj,
                    id: noticeObj._id.toString()
                };
            });

            return res.status(200).json(createResponse(
                true,
                "Success",
                'Notices retrieved successfully',
                transformedNotices
            ));
        }

        return res.status(404).json(createResponse(
            false,
            "Error",
            'No notices found'
        ));
    } catch (error) {
        res.status(500).json(createResponse(
            false,
            "Error",
            'Error retrieving notices',
            null,
            error.message
        ));
    }
});

// Get single notice
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        let notice = null;

        // Create a query array to try different ways of finding the notice
        const queries = [
            // Only try ObjectId if it's valid
            ...(mongoose.Types.ObjectId.isValid(id) ? 
                [{ _id: new mongoose.Types.ObjectId(id) }] : 
                []
            ),
            { id: id },  // Try matching against the string id field
        ];

        // Try each query strategy until we find a match
        for (const query of queries) {
            notice = await Notice.findOne(query);
            if (notice) break;
        }

        // If still not found in database, check local storage
        if (!notice) {
            try {
                const localNoticesData = await fs.readFile(LOCAL_NOTICES_PATH, 'utf8');
                const localNotices = JSON.parse(localNoticesData).notices;
                notice = localNotices.find(n => n.id === id || n._id === id);

                if (notice) {
                    return res.status(200).json(createResponse(
                        true,
                        "Success",
                        'Notice retrieved from local storage',
                        {
                            ...notice,
                            id: notice.id || notice._id // Ensure consistent ID field
                        }
                    ));
                }
            } catch (localError) {
                console.error('Local Storage Retrieval Error:', localError);
            }
        }

        if (!notice) {
            return res.status(404).json(createResponse(
                false,
                "Error",
                'Notice not found',
                null,
                `No notice found with ID: ${id}`
            ));
        }

        // Convert to plain object and ensure consistent ID field
        const noticeObject = notice.toObject();
        noticeObject.id = noticeObject._id.toString();

        return res.status(200).json(createResponse(
            true,
            "Success",
            'Notice retrieved successfully',
            noticeObject
        ));

    } catch (error) {
        console.error('Notice Retrieval Error:', error);
        res.status(500).json(createResponse(
            false,
            "Error",
            'Error retrieving notice',
            null,
            error.message
        ));
    }
});

router.post('/sync-local', authenticateToken, validateNoticeDetails, async (req, res) => {
    try {
        const { notices } = req.body;

        if (!notices || notices.length === 0) {
            return res.status(404).json(createResponse(
                false,
                "Error",
                'No notices found to sync'
            ));
        }

        const results = {
            success: [],
            failed: []
        };

        for (const notice of notices) {
            try {
                // Ensure noticeDetails is an array
                if (!Array.isArray(notice.noticeInfo.noticeDetails)) {
                    notice.noticeInfo.noticeDetails = [notice.noticeInfo.noticeDetails];
                }

                const existingNotice = await Notice.findOne({
                    $and: [
                        { title: notice.title },
                        { 'noticeInfo.organisationName': notice.noticeInfo.organisationName },
                        { 'eventSchedule.dateFromStart': notice.eventSchedule.dateFromStart },
                        { 'eventSchedule.dateToEnd': notice.eventSchedule.dateToEnd }
                    ]
                });

                if (existingNotice) {
                    results.success.push({
                        id: existingNotice._id.toString(),
                        status: 'skipped',
                        message: 'Notice already exists'
                    });
                    continue;
                }

                const completeNotice = {
                    ...notice,
                    priority: notice.priority || NoticePriority.NORMAL,
                    status: notice.status || NoticeStatus.ACTIVE,
                    audience: notice.audience || { isSchoolWide: false },
                    attachments: notice.attachments || []
                };

                const newNotice = new Notice(completeNotice);
                const saved = await newNotice.save();
                
                results.success.push({
                    id: saved._id.toString(),
                    status: 'created',
                    message: 'New notice created'
                });
            } catch (error) {
                results.failed.push({
                    notice: notice.title,
                    error: error.message
                });
            }
        }

        res.status(200).json(createResponse(
            true,
            "Success",
            'Local notices synced with server',
            { 
                success: results.success, 
                failed: results.failed,
                summary: {
                    total: notices.length,
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
            'Error syncing local notices with server',
            null,
            error.message
        ));
    }
});

router.post('/', authenticateToken, validateNoticeDetails, async (req, res) => {
    try {
        const { 
            title, 
            noticeInfo, 
            eventSchedule, 
            audience = { isSchoolWide: false },
            priority = NoticePriority.NORMAL,
            status = NoticeStatus.ACTIVE,
            attachments = []
        } = req.body;

        // Validate that attachment IDs exist in GridFS
        for (const attachment of attachments) {
            try {
                await bucket.find({ _id: new mongoose.Types.ObjectId(attachment.id) }).next();
            } catch (error) {
                return res.status(400).json(createResponse(
                    false,
                    "Error",
                    `Attachment ${attachment.id} not found`
                ));
            }
        }

        const newNotice = new Notice({
            title,
            noticeInfo,
            eventSchedule,
            audience,
            priority,
            status,
            attachments
        });

        const savedNotice = await newNotice.save();
        res.status(201).json(createResponse(
            true,
            "Success",
            'Notice created successfully',
            savedNotice
        ));
    } catch (error) {
        res.status(500).json(createResponse(
            false,
            "Error",
            'Error creating notice',
            null,
            error.message
        ));
    }
});

router.get('/filter', authenticateToken, async (req, res) => {
    try {
        const { 
            startDate, 
            endDate, 
            noticeType, 
            organisationName,
            searchQuery 
        } = req.query;

        let filter = {};

        if (startDate && endDate) {
            filter['eventSchedule.dateFromStart'] = { $gte: startDate };
            filter['eventSchedule.dateToEnd'] = { $lte: endDate };
        }

        if (noticeType) {
            filter['noticeInfo.noticeType'] = noticeType;
        }

        if (organisationName) {
            filter['noticeInfo.organisationName'] = { 
                $regex: new RegExp(organisationName, 'i') 
            };
        }

        // Updated search query to search within the array of notice details
        if (searchQuery) {
            filter.$or = [
                { title: { $regex: new RegExp(searchQuery, 'i') } },
                { 'noticeInfo.noticeDetails': { 
                    $elemMatch: { 
                        $regex: new RegExp(searchQuery, 'i') 
                    } 
                }}
            ];
        }

        const notices = await Notice.find(filter)
            .sort({ 'eventSchedule.dateCreated': -1 });

        if (notices && notices.length > 0) {
            return res.status(200).json(createResponse(
                true,
                "Success",
                'Filtered notices retrieved successfully',
                notices
            ));
        }

        return res.status(404).json(createResponse(
            false,
            "Error",
            'No notices found matching the filter criteria'
        ));

    } catch (error) {
        res.status(500).json(createResponse(
            false,
            "Error",
            'Error filtering notices',
            null,
            error.message
        ));
    }
});


// Additional routes to expose enums
router.get('/priorities', authenticateToken, (req, res) => {
    res.status(200).json(createResponse(
        true,
        "Success",
        'Notice priorities retrieved',
        Object.values(NoticePriority)
    ));
});

router.get('/categories', authenticateToken, (req, res) => {
    res.status(200).json(createResponse(
        true,
        "Success",
        'Notice categories retrieved',
        Object.values(NoticeCategory)
    ));
});

router.get('/statuses', authenticateToken, (req, res) => {
    res.status(200).json(createResponse(
        true,
        "Success",
        'Notice statuses retrieved',
        Object.values(NoticeStatus)
    ));
});

module.exports = router;
