const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || "St-Joseph-Academy";
const LOCAL_QUOTES_PATH = path.join(__dirname, '..', 'local_quotes.json');
const ZENQUOTES_API = 'https://zenquotes.io/api/today';

// Authentication middleware 
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            type: "Error",
            success: false,
            message: 'Access token is required'
        });
    }

    try {
        const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET);
        req.userId = decoded.id;
        next();
    } catch (error) {
        return res.status(403).json({
            type: "Error",
            success: false,
            message: 'Invalid or expired token'
        });
    }
};

// Get daily quote with API and local fallback
router.get('/', authenticateToken, async (req, res) => {
    try {
        // Try to fetch from Zenquotes API first
        try {
            const apiResponse = await axios.get(ZENQUOTES_API);
            if (apiResponse.data && apiResponse.data.length > 0) {
                const quote = apiResponse.data[0];
                return res.status(200).json({
                    type: "Success",
                    success: true,
                    message: 'Quote retrieved from online API',
                    data: {
                        q: quote.q,
                        a: quote.a
                    }
                });
		    console.log("Quote Sending Successful, Quote : \n ${quote}")
            }
        } catch (apiError) {
            console.error('API fetch error:', apiError.message);
        }

        // Fallback to local quotes
        try {
            const localData = await fs.readFile(LOCAL_QUOTES_PATH, 'utf8');
            const localQuotes = JSON.parse(localData).quotes;
            
            if (localQuotes && localQuotes.length > 0) {
                // Randomly select a quote from local storage
                const randomQuote = localQuotes[Math.floor(Math.random() * localQuotes.length)];
                return res.status(206).json({
                    type: "Success",
                    success: true,
                    message: 'Quote retrieved from local storage',
                    data: randomQuote
                });
            }
        } catch (localError) {
            console.error('Local quotes read error:', localError);
        }

        // No quotes found
        res.status(404).json({
            type: "Error",
            success: false,
            message: 'No quotes available'
        });

    } catch (error) {
        res.status(500).json({
            type: "Error",
            success: false,
            message: 'Error retrieving quote',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Update local quotes storage
router.post('/update-local', authenticateToken, async (req, res) => {
    try {
        // Fetch quotes from Zenquotes API
        const apiResponse = await axios.get(ZENQUOTES_API);
        
        if (!apiResponse.data || apiResponse.data.length === 0) {
            return res.status(404).json({
                type: "Error",
                success: false,
                message: 'No quotes to update in local storage'
            });
        }

        // Write quotes to local storage
        await fs.writeFile(
            LOCAL_QUOTES_PATH, 
            JSON.stringify({ quotes: apiResponse.data }, null, 2)
        );
        
        res.status(200).json({
            type: "Success",
            success: true,
            message: 'Local quotes updated successfully',
            data: apiResponse.data
        });
    } catch (error) {
        res.status(500).json({
            type: "Error",
            success: false,
            message: 'Error updating local quotes',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

module.exports = router;
