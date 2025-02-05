const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const twilio = require('twilio');
const crypto = require('crypto');
const dotenv = require('dotenv');

//dotenv.config(); // Load environment variables

//const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

// Configuration Constants
const CONFIG = {
    REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET || "Principal_@_St_Joseph_Academy",
    ACCESS_TOKEN_SECRET: process.env.ACCESS_TOKEN_SECRET || "St-Joseph-Academy",
    ACCESS_TOKEN_EXPIRY: '15m',
    REFRESH_TOKEN_EXPIRY: '7d',
    SALT_ROUNDS: 12,
    MIN_PASSWORD_LENGTH: 8,  // Aligned with Kotlin implementation
    MAX_REFRESH_TOKENS: 3    // Limit number of refresh tokens per user
};

// Response Helpers: Create standardized responses for consistent API communication
const createResponse = {
    success: (message, data = null) => ({
        type: "Success",
        success: true,
        message,
        data
    }),
    error: (message, errors = null) => ({
        type: "Error",
        success: false,
        message,
        errors
    })
};

// Input Validation Middleware: Ensures data integrity before processing
const validateInput = {
	verifyUser : (req, res, next) => {
    try {
        // Get token from header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                type: 'Error',
                message: 'Authorization header missing or invalid format',
                error: 'No token provided'
            });
        }

        // Extract token (remove 'Bearer ' prefix)
        const token = authHeader.split(' ')[1];

        // Verify token
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Add user info to request object
        req.user = {
            userId: decoded.userId,
            admissionNo: decoded.admissionNo
        };
        
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                type: 'Error',
                message: 'Token has expired',
                error: 'Token expired'
            });
        }
        
        return res.status(401).json({
            success: false,
            type: 'Error',
            message: 'Invalid token',
            error: error.message
        });
    }
},

    login: (req, res, next) => {
        const { admissionNo, password } = req.body;
        const errors = [];

        if (!admissionNo || !admissionNo.match(/^\d{6}$/)) {
            errors.push({ field: 'admissionNo', message: 'Admission number must be 6 digits' });
        }

        if (!password || password.length < CONFIG.MIN_PASSWORD_LENGTH) {
            errors.push({ 
                field: 'password', 
                message: `Password must be at least ${CONFIG.MIN_PASSWORD_LENGTH} characters` 
            });
        }

        if (errors.length) {
            return res.status(400).json(createResponse.error('Validation failed', errors));
        }
        next();
    },

    register: (req, res, next) => {
        const { name, admissionNo, password, phone } = req.body;
        const errors = [];

        if (!name || name.length < 2) {
            errors.push({ field: 'name', message: 'Name must be at least 2 characters' });
        }

        if (!admissionNo || !admissionNo.match(/^\d{6}$/)) {
            errors.push({ field: 'admissionNo', message: 'Admission number must be 6 digits' });
        }

        if (!password || password.length < CONFIG.MIN_PASSWORD_LENGTH) {
            errors.push({ 
                field: 'password', 
                message: `Password must be at least ${CONFIG.MIN_PASSWORD_LENGTH} characters` 
            });
        }

        if (!phone || !phone.match(/^\d{10}$/)) {
            errors.push({ field: 'phone', message: 'Phone number must be 10 digits' });
        }

        if (errors.length) {
            return res.status(400).json(createResponse.error('Validation failed', errors));
        }
        next();
    }
};

router.get('/user', validateInput.verifyUser, async (req, res) => {
    try {
        // Find user by ID (from token)
        const user = await User.findById(req.user.userId)
            .select('-password'); // Exclude password from response
        
        if (!user) {
            return res.status(404).json({
                success: false,
                type: 'Error',
                message: 'User not found',
                error: 'User does not exist'
            });
        }

        // Return user data
        return res.status(200).json({
            success: true,
            type: 'Success',
            message: 'User retrieved successfully',
            data: user
        });
    } catch (error) {
        console.error('Error fetching user:', error);
        return res.status(500).json({
            success: false,
            type: 'Error',
            message: 'Failed to retrieve user',
            error: error.message
        });
    }
});


// Login Route: Handles user authentication
router.post('/login', validateInput.login, async (req, res) => {
    try {
        const { admissionNo, password } = req.body;
        
        const user = await User.findOne({ admissionNo }).select('+password');
        if (!user) {
            return res.status(401).json(createResponse.error('Invalid credentials'));
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json(createResponse.error('Invalid credentials'));
        }

        const tokens = generateTokens(user);
        await updateUserTokens(user, tokens.refreshToken);

        return res.status(200).json(createResponse.success('Login successful', {
            ...tokens,
            user: formatUserResponse(user)
        }));
        
    } catch (error) {
        handleServerError(res, error, 'Login failed');
    }
});

// Registration Route: Creates new user account
router.post('/register', validateInput.register, async (req, res) => {
    try {
        const { name, admissionNo, password, phone } = req.body;

        // Validate admission number against pre-registered numbers
        const admissionNumbersPath = path.join(__dirname, '../admissionNumbers.json');
        const admissionNumbersData = await fs.readFile(admissionNumbersPath, 'utf8');
        const admissionNumbers = JSON.parse(admissionNumbersData).admissionNumbers;

        if (!admissionNumbers.includes(admissionNo)) {
            return res.status(400).json(createResponse.error('Invalid admission number'));
        }

        const existingUser = await User.findOne({ admissionNo });
        if (existingUser) {
            return res.status(400).json(createResponse.error('Admission number already registered'));
        }

        const hashedPassword = await bcrypt.hash(password, CONFIG.SALT_ROUNDS);
        const currentDate = new Date().toISOString().split('T')[0]; // Match LocalDate format

        const newUser = new User({
            name,
            admissionNo,
            password: hashedPassword,
            phone,
            refreshTokens: [],
            createdAt: currentDate,
            updatedAt: currentDate
        });

        await newUser.save();

        const tokens = generateTokens(newUser);
        await updateUserTokens(newUser, tokens.refreshToken);

        res.status(201).json(createResponse.success('User registered successfully', {
            ...tokens,
            user: formatUserResponse(newUser)
        }));
    } catch (error) {
        handleServerError(res, error, 'Registration failed');
    }
});

// Token Refresh Route: Generates new access tokens
router.post('/refresh-token', async (req, res) => {
    try {
        const { refreshToken } = req.body;
        
        if (!refreshToken) {
            return res.status(400).json(createResponse.error('Refresh token is required'));
        }

        const decoded = jwt.verify(refreshToken, CONFIG.REFRESH_TOKEN_SECRET);
        
        const user = await User.findById(decoded.id);
        if (!user || !user.refreshTokens.includes(refreshToken)) {
            return res.status(401).json(createResponse.error('Invalid refresh token'));
        }

        const newAccessToken = generateAccessToken(user);

        res.status(200).json(createResponse.success('Token refreshed successfully', {
            accessToken: newAccessToken
        }));
    } catch (error) {
        handleTokenError(res, error);
    }
});

// Helper Functions: Modular functions for token and response management
function generateAccessToken(user) {
    return jwt.sign(
        { id: user._id },
        CONFIG.ACCESS_TOKEN_SECRET,
        { expiresIn: CONFIG.ACCESS_TOKEN_EXPIRY }
    );
}

function generateRefreshToken(user) {
    return jwt.sign(
        { id: user._id },
        CONFIG.REFRESH_TOKEN_SECRET,
        { expiresIn: CONFIG.REFRESH_TOKEN_EXPIRY }
    );
}

function generateTokens(user) {
    return {
        accessToken: generateAccessToken(user),
        refreshToken: generateRefreshToken(user)
    };
}

async function updateUserTokens(user, newRefreshToken) {
    user.refreshTokens = user.refreshTokens.filter(token => {
        try {
            jwt.verify(token, CONFIG.REFRESH_TOKEN_SECRET);
            return true;
        } catch {
            return false;
        }
    });

    // Limit number of refresh tokens
    if (user.refreshTokens.length >= CONFIG.MAX_REFRESH_TOKENS) {
        user.refreshTokens.shift(); // Remove oldest token
    }
    
    user.refreshTokens.push(newRefreshToken);
    await user.save();
}

function formatUserResponse(user) {
    return {
        id: user._id.toString(),
        name: user.name,
        admissionNo: user.admissionNo,
        phone: user.phone,
        createdAt: user.createdAt,  // Already in YYYY-MM-DD format
        updatedAt: user.updatedAt   // Already in YYYY-MM-DD format
    };
}

function handleServerError(res, error, defaultMessage) {
    console.error(error);
    const errorMessage = process.env.NODE_ENV === 'development' 
        ? error.message 
        : defaultMessage;
    
    res.status(500).json(createResponse.error(errorMessage));
}

function handleTokenError(res, error) {
    if (error instanceof jwt.TokenExpiredError) {
        return res.status(401).json(createResponse.error('Refresh token expired'));
    }
    
    res.status(500).json(createResponse.error('Token refresh failed'));
}
/*
router.post('/forgot-password', async (req, res) => {
    try {
        const { phone } = req.body;

        const user = await User.findOne({ phone });
        if (!user) {
            return res.status(404).json(createResponse.error('User not found'));
        }

        // Generate a 6-digit OTP
        const otp = crypto.randomInt(100000, 999999).toString();
        const otpExpiry = Date.now() + 5 * 60 * 1000; // OTP valid for 5 minutes

        user.otp = otp;
        user.otpExpiry = otpExpiry;
        await user.save();

        // Send OTP via SMS
        await twilioClient.messages.create({
            body: `Your OTP for password reset is: ${otp}`,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: phone
        });

        res.status(200).json(createResponse.success('OTP sent successfully'));
    } catch (error) {
        console.error('Error sending OTP:', error);
        res.status(500).json(createResponse.error('Failed to send OTP'));
    }
});

router.post('/verify-otp', async (req, res) => {
    try {
        const { phone, otp } = req.body;

        const user = await User.findOne({ phone });
        if (!user || user.otp !== otp || user.otpExpiry < Date.now()) {
            return res.status(400).json(createResponse.error('Invalid or expired OTP'));
        }

        // OTP is valid; allow password reset
        res.status(200).json(createResponse.success('OTP verified successfully'));
    } catch (error) {
        console.error('OTP verification error:', error);
        res.status(500).json(createResponse.error('Failed to verify OTP'));
    }
});


router.post('/reset-password', async (req, res) => {
    try {
        const { phone, newPassword } = req.body;

        const user = await User.findOne({ phone });
        if (!user) {
            return res.status(400).json(createResponse.error('User not found'));
        }

        // Hash the new password
        const hashedPassword = await bcrypt.hash(newPassword, CONFIG.SALT_ROUNDS);
        user.password = hashedPassword;

        // Clear OTP fields
        user.otp = undefined;
        user.otpExpiry = undefined;
        await user.save();

        res.status(200).json(createResponse.success('Password reset successfully'));
    } catch (error) {
        console.error('Password reset error:', error);
        res.status(500).json(createResponse.error('Failed to reset password'));
    }
});
*/

module.exports = router;
