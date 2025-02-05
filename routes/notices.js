const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const fs = require('fs').promises;
const mongoose = require('mongoose');
const path = require('path');
const Notice = require('../models/Notice');

// Path to local notices JSON
const LOCAL_NOTICES_PATH = path.join(__dirname, '..', 'local_notices.json');


const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || "St-Joseph-Academy";

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

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    
    // Debugging logs
    //console.log('Full Authorization Header(Notice): \n', authHeader,"\n");

    // Corrected token extraction
    const token = authHeader && authHeader.split(' ').pop();

    //console.log('Extracted Token(Notice): \n', token,"\n");

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
        console.error('Token Verification Error:', error);
        return res.status(403).json(createResponse(
            false,
            "Error",
            'Invalid or expired token',
            null,
            process.env.NODE_ENV === 'development' ? error.message : undefined
        ));
    }
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

// Update the sync-local route
router.post('/sync-local', authenticateToken, async (req, res) => {
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
                // Check if notice already exists using multiple fields for matching
                const existingNotice = await Notice.findOne({
                    $and: [
                        { title: notice.title },
                        { 'noticeInfo.organisationName': notice.noticeInfo.organisationName },
                        { 'eventSchedule.dateFromStart': notice.eventSchedule.dateFromStart },
                        { 'eventSchedule.dateToEnd': notice.eventSchedule.dateToEnd }
                    ]
                });

                if (existingNotice) {
                    // Notice already exists, skip creation
                    results.success.push({
                        id: existingNotice._id.toString(),
                        status: 'skipped',
                        message: 'Notice already exists'
                    });
                    continue;
                }

                // Create new notice only if it doesn't exist
                const newNotice = new Notice(notice);
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
            // Add any other potential ID matching strategies here
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

router.post('/update-local', authenticateToken, async (req, res) => {
    try {
        const notices = await Notice.find().sort({ 'eventSchedule.dateCreated': -1 });
        
        if (!notices || notices.length === 0) {
            return res.status(404).json(createResponse(
                false,
                "Error",
                'No notices to update in local storage'
            ));
        }

        // Write notices to local JSON file
        await fs.writeFile(LOCAL_NOTICES_PATH, JSON.stringify({ notices }, null, 2));

        res.status(200).json(createResponse(
            true,
            "Success",
            'Local notices updated successfully',
            notices
        ));
    } catch (error) {
        res.status(500).json(createResponse(
            false,
            "Error",
            'Error updating local notices',
            null,
            error.message
        ));
    }
});

// Create new notice
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { title, noticeInfo, eventSchedule } = req.body;

        if (!title || !noticeInfo || !eventSchedule) {
            return res.status(400).json(createResponse(
                false,
                "Error",
                'Missing required fields'
            ));
        }

        const { date, time } = getCurrentDateTime();
        const newNotice = new Notice({
            title,
            noticeInfo,
            eventSchedule: {
                ...eventSchedule,
                dateCreated: date,
                timeCreated: time
            }
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

// Filter notices by date range
router.get('/filter', authenticateToken, async (req, res) => {
    try {
        const { 
            startDate, 
            endDate, 
            noticeType, 
            organisationName,
            searchQuery 
        } = req.query;

        // Build filter object
        let filter = {};

        // Date range filter
        if (startDate && endDate) {
            filter['eventSchedule.dateFromStart'] = { $gte: startDate };
            filter['eventSchedule.dateToEnd'] = { $lte: endDate };
        }

        // Notice type filter
        if (noticeType) {
            filter['noticeInfo.noticeType'] = noticeType;
        }

        // Organization name filter
        if (organisationName) {
            filter['noticeInfo.organisationName'] = { 
                $regex: new RegExp(organisationName, 'i') 
            };
        }

        // Search query for title or notice details
        if (searchQuery) {
            filter.$or = [
                { title: { $regex: new RegExp(searchQuery, 'i') } },
                { 'noticeInfo.noticeDetails': { $regex: new RegExp(searchQuery, 'i') } }
            ];
        }

        // First try to get filtered notices from database
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

        // If no notices in database, try filtering local notices
        try {
            const localNoticesData = await fs.readFile(LOCAL_NOTICES_PATH, 'utf8');
            const localNotices = JSON.parse(localNoticesData).notices;

            const filteredLocalNotices = localNotices.filter(notice => {
                let matches = true;

                // Date range filter
                if (startDate && endDate) {
                    matches = matches && 
                        notice.eventSchedule.dateFromStart >= startDate &&
                        notice.eventSchedule.dateToEnd <= endDate;
                }

                // Notice type filter
                if (noticeType) {
                    matches = matches && 
                        notice.noticeInfo.noticeType === noticeType;
                }

                // Organization name filter
                if (organisationName) {
                    matches = matches && 
                        notice.noticeInfo.organisationName.toLowerCase()
                            .includes(organisationName.toLowerCase());
                }

                // Search query
                if (searchQuery) {
                    const searchRegex = new RegExp(searchQuery, 'i');
                    matches = matches && (
                        searchRegex.test(notice.title) ||
                        searchRegex.test(notice.noticeInfo.noticeDetails)
                    );
                }

                return matches;
            });

            if (filteredLocalNotices.length > 0) {
                return res.status(206).json(createResponse(
                    true,
                    "Success",
                    'Filtered notices retrieved from local storage',
                    filteredLocalNotices
                ));
            }
        } catch (localError) {
            console.error('Error reading local notices:', localError);
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

module.exports = router;
