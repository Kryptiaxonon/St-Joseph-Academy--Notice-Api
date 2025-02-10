require('dotenv').config();
var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var mongoose = require('mongoose');
var helmet = require('helmet');
var rateLimit = require('express-rate-limit');

// Load environment variables
const MONGODB_URI = process.env.MONGODB_URI;
const NODE_ENV = process.env.NODE_ENV || 'development';
const AUTH_ADMISSION_NO = process.env.AUTH_ADMISSION_NO;
const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

// Import routes
const usersRouter = require('./routes/users');
const quoteRoutes = require('./routes/quotes');
const AuthSyncService = require('./authSyncService');
const noticesRoutes = require('./routes/notices');
const reportsRoutes = require('./routes/reports');
const authRoutes = require('./routes/auth');
const mediaRoutes = require('./routes/media');

const app = express();

// Security middleware
app.use(helmet());

// Rate limiting
const limiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

// Middleware
app.use(logger(NODE_ENV === 'development' ? 'dev' : 'combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Static files with security headers
app.use('/uploads', express.static('uploads', {
    maxAge: '1d',
    setHeaders: (res) => {
        res.set('X-Content-Type-Options', 'nosniff');
    }
}));

// Routes
app.use('/auth', authRoutes);
app.use('/api/quote', quoteRoutes);
app.use('/api/notices', noticesRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/media', mediaRoutes);
app.use('/users', usersRouter);

// Health check with basic system info
app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// MongoDB connection with retry logic
async function connectWithRetry(retries = 10, delay = 10000) {
    for (let i = 0; i < retries; i++) {
        try {
            await mongoose.connect(MONGODB_URI, {
                useNewUrlParser: true,
                useUnifiedTopology: true,
                serverSelectionTimeoutMS: 10000,
            });
            console.log('Connected to MongoDB Atlas');
            return true;
        } catch (err) {
            if (i === retries - 1) throw err;
            console.log(`Failed to connect to MongoDB. Retrying in ${delay/1000}s...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    return false;
}

// Application initialization

async function initializeApp() {
    try {
        await connectWithRetry();

        const syncService = new AuthSyncService({
            serverUrl: SERVER_URL,
            credentials: {
                admissionNo: AUTH_ADMISSION_NO,
                password: AUTH_PASSWORD
            },
            onSyncComplete: (results) => console.log('Sync completed:', results),
            onSyncError: (error) => console.error('Sync error:', error)
        });

        const started = await syncService.start();
        if (!started) {
            console.error('Failed to start sync service');
            // Continue running the app even if sync service fails
        }
    } catch (err) {
        //console.error('Fatal error during initialization:', err);
        process.exit(1);
    }
}

// Initialize the application
initializeApp().catch();//console.error);

// Error handling middleware
app.use((req, res, next) => {
    next(createError(404));
});

app.use((err, req, res, next) => {
    // Don't expose stack traces in production
    const error = NODE_ENV === 'development' ? err : {};
    
    res.status(err.status || 500);
    res.format({
        json: () => {
            res.json({
                message: err.message,
                error: NODE_ENV === 'development' ? err : {}
            });
        },
        html: () => {
            res.render('error', {
                message: err.message,
                error: error
            });
        }
    });
});

module.exports = app;
