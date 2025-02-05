const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const fs = require('fs').promises;
const mongoose = require('mongoose');
const path = require('path');
const Media = require('../models/Media');

// Path to local media JSON
const LOCAL_MEDIA_PATH = path.join(__dirname, '..', 'local_media.json');

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
    //console.log('Full Authorization Header(Media): \n', authHeader,"\n");

    // Corrected token extraction
    const token = authHeader && authHeader.split(' ').pop();

    //console.log('Extracted Token(Media): \n', token,"\n");

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

// Get all media
router.get('/', authenticateToken, async (req, res) => {
    try {
        const media = await Media.find().sort({ dateUploaded: -1 });
        
        if (media && media.length > 0) {
            // Transform to use _id as id
            const transformedMedia = media.map(mediaItem => {
                const mediaObj = mediaItem.toObject();
                return {
                    ...mediaObj,
                    id: mediaObj._id.toString()
                };
            });

            return res.status(200).json(createResponse(
                true,
                "Success",
                'Media retrieved successfully',
                transformedMedia
            ));
        }

        return res.status(404).json(createResponse(
            false,
            "Error",
            'No media found'
        ));
    } catch (error) {
        res.status(500).json(createResponse(
            false,
            "Error",
            'Error retrieving media',
            null,
            error.message
        ));
    }
});

// Sync local media
router.post('/sync-local', authenticateToken, async (req, res) => {
    try {
        const { media } = req.body;

        if (!media || media.length === 0) {
            return res.status(404).json(createResponse(
                false,
                "Error",
                'No media found to sync'
            ));
        }

        const results = {
            success: [],
            failed: []
        };

        for (const mediaItem of media) {
            try {
                // Check if media already exists using multiple fields for matching
                const existingMedia = await Media.findOne({
                    $and: [
                        { title: mediaItem.title },
                        { url: mediaItem.url },
                        { type: mediaItem.type }
                    ]
                });

                if (existingMedia) {
                    // Media already exists, skip creation
                    results.success.push({
                        id: existingMedia._id.toString(),
                        status: 'skipped',
                        message: 'Media already exists'
                    });
                    continue;
                }

                // Create new media only if it doesn't exist
                const newMedia = new Media(mediaItem);
                const saved = await newMedia.save();
                
                results.success.push({
                    id: saved._id.toString(),
                    status: 'created',
                    message: 'New media created'
                });
            } catch (error) {
                results.failed.push({
                    media: mediaItem.title,
                    error: error.message
                });
            }
        }

        res.status(200).json(createResponse(
            true,
            "Success",
            'Local media synced with server',
            { 
                success: results.success, 
                failed: results.failed,
                summary: {
                    total: media.length,
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
            'Error syncing local media with server',
            null,
            error.message
        ));
    }
});

// Get single media item
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        let mediaItem = null;

        // Create a query array to try different ways of finding the media
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
            mediaItem = await Media.findOne(query);
            if (mediaItem) break;
        }

        // If still not found in database, check local storage
        if (!mediaItem) {
            try {
                const localMediaData = await fs.readFile(LOCAL_MEDIA_PATH, 'utf8');
                const localMedia = JSON.parse(localMediaData).media;
                mediaItem = localMedia.find(m => m.id === id || m._id === id);

                if (mediaItem) {
                    return res.status(200).json(createResponse(
                        true,
                        "Success",
                        'Media retrieved from local storage',
                        {
                            ...mediaItem,
                            id: mediaItem.id || mediaItem._id // Ensure consistent ID field
                        }
                    ));
                }
            } catch (localError) {
                console.error('Local Storage Retrieval Error:', localError);
            }
        }

        if (!mediaItem) {
            return res.status(404).json(createResponse(
                false,
                "Error",
                'Media not found',
                null,
                `No media found with ID: ${id}`
            ));
        }

        // Convert to plain object and ensure consistent ID field
        const mediaObject = mediaItem.toObject();
        mediaObject.id = mediaObject._id.toString();

        return res.status(200).json(createResponse(
            true,
            "Success",
            'Media retrieved successfully',
            mediaObject
        ));

    } catch (error) {
        console.error('Media Retrieval Error:', error);
        res.status(500).json(createResponse(
            false,
            "Error",
            'Error retrieving media',
            null,
            error.message
        ));
    }
});

// Update local media storage
router.post('/update-local', authenticateToken, async (req, res) => {
    try {
        const media = await Media.find().sort({ dateUploaded: -1 });
        
        if (!media || media.length === 0) {
            return res.status(404).json(createResponse(
                false,
                "Error",
                'No media to update in local storage'
            ));
        }

        // Write media to local JSON file
        await fs.writeFile(LOCAL_MEDIA_PATH, JSON.stringify({ media }, null, 2));

        res.status(200).json(createResponse(
            true,
            "Success",
            'Local media updated successfully',
            media
        ));
    } catch (error) {
        res.status(500).json(createResponse(
            false,
            "Error",
            'Error updating local media',
            null,
            error.message
        ));
    }
});

// Create new media
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { 
            title, 
            type, 
            url, 
            thumbnailUrl, 
            size 
        } = req.body;

        if (!title || !type || !url || !size) {
            return res.status(400).json(createResponse(
                false,
                "Error",
                'Missing required fields'
            ));
        }

        const { date, time } = getCurrentDateTime();
        const newMedia = new Media({
            title,
            type,
            url,
            thumbnailUrl,
            size,
            dateUploaded: date,
            timeUploaded: time,
            user: req.userId  // Use authenticated user's ID
        });

        const savedMedia = await newMedia.save();
        res.status(201).json(createResponse(
            true,
            "Success",
            'Media created successfully',
            savedMedia
        ));
    } catch (error) {
        res.status(500).json(createResponse(
            false,
            "Error",
            'Error creating media',
            null,
            error.message
        ));
    }
});

// Filter media
router.get('/filter', authenticateToken, async (req, res) => {
    try {
        const { 
            startDate, 
            endDate, 
            type, 
            searchQuery 
        } = req.query;

        // Build filter object
        let filter = {};

        // Date range filter
        if (startDate && endDate) {
            filter.dateUploaded = { 
                $gte: startDate,
                $lte: endDate 
            };
        }

        // Media type filter
        if (type) {
            filter.type = type;
        }

        // Search query for title
        if (searchQuery) {
            filter.title = { 
                $regex: new RegExp(searchQuery, 'i') 
            };
        }

        // First try to get filtered media from database
        const media = await Media.find(filter)
            .sort({ dateUploaded: -1 });

        if (media && media.length > 0) {
            return res.status(200).json(createResponse(
                true,
                "Success",
                'Filtered media retrieved successfully',
                media
            ));
        }

        // If no media in database, try filtering local media
        try {
            const localMediaData = await fs.readFile(LOCAL_MEDIA_PATH, 'utf8');
            const localMedia = JSON.parse(localMediaData).media;

            const filteredLocalMedia = localMedia.filter(mediaItem => {
                let matches = true;

                // Date range filter
                if (startDate && endDate) {
                    matches = matches && 
                        mediaItem.dateUploaded >= startDate &&
                        mediaItem.dateUploaded <= endDate;
                }

                // Media type filter
                if (type) {
                    matches = matches && mediaItem.type === type;
                }

                // Search query
                if (searchQuery) {
                    const searchRegex = new RegExp(searchQuery, 'i');
                    matches = matches && searchRegex.test(mediaItem.title);
                }

                return matches;
            });

            if (filteredLocalMedia.length > 0) {
                return res.status(206).json(createResponse(
                    true,
                    "Success",
                    'Filtered media retrieved from local storage',
                    filteredLocalMedia
                ));
            }
        } catch (localError) {
            console.error('Error reading local media:', localError);
        }

        return res.status(404).json(createResponse(
            false,
            "Error",
            'No media found matching the filter criteria'
        ));

    } catch (error) {
        res.status(500).json(createResponse(
            false,
            "Error",
            'Error filtering media',
            null,
            error.message
        ));
    }
});

module.exports = router;
