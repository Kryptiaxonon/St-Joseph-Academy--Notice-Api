const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

class AuthSyncService {
    constructor(config) {
        this.config = {
            serverUrl: config.serverUrl || 'http://localhost:3000',
            checkInterval: config.checkInterval || 30000,
            retryDelay: config.retryDelay || 60000,
            maxRetries: config.maxRetries || 5,
            credentials: {
                admissionNo: config.credentials.admissionNo,
                password: config.credentials.password
            },
            onSyncComplete: config.onSyncComplete || (() => {}),
            onSyncError: config.onSyncError || (() => {})
        };

        this.isOnline = false;
        this.syncInterval = null;
        this.retryCount = 0;
        this.accessToken = null;
        
        this.localPaths = {
            notices: path.join(__dirname, 'local_notices.json'),
            reports: path.join(__dirname, 'local_reports.json'),
	    media: path.join(__dirname, 'local_media.json') 
        };

        // Add cleanup handler
        process.on('SIGTERM', () => this.stop());
        process.on('SIGINT', () => this.stop());
    }

    // Calculate exponential backoff delay
    getRetryDelay() {
        return Math.min(
            this.config.retryDelay * Math.pow(2, this.retryCount),
            300000 // Max 5 minutes
        );
    }

    async authenticate() {
        try {
            const response = await axios.post(`${this.config.serverUrl}/auth/login`, {
                admissionNo: this.config.credentials.admissionNo,
                password: this.config.credentials.password
            });

            if (!response?.data?.success || !response?.data?.data?.accessToken) {
                throw new Error('Invalid authentication response');
            }

            this.accessToken = response.data.data.accessToken;
            console.log('Authentication successful');
            return true;
        } catch (error) {
            console.error('Authentication failed:', {
                message: error.message, 
            });
            this.config.onSyncError(error);
            return false;
        }
    }

    async start() {
        console.log('Starting auth-sync service...');
        
        try {
            const isAuthenticated = await this.authenticate();
            if (!isAuthenticated) {
                console.error('Failed to authenticate. Service not started.');
                return false;
            }

            await this.checkConnectionAndSync();
            
            this.syncInterval = setInterval(() => {
                this.checkConnectionAndSync();
            }, this.config.checkInterval);

            return true;
        } catch (error) {
            console.error('Service start failed:', error);
            return false;
        }
    }

    async stop() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
        this.accessToken = null;
        this.isOnline = false;
        this.retryCount = 0;
        console.log('Auth-sync service stopped');
    }

    async checkConnectionAndSync() {
        try {
            const response = await axios.get(
                `${this.config.serverUrl}/api/health`,
                {
                    headers: { 'Authorization': `Bearer ${this.accessToken}` },
                    timeout: 5000 // Add timeout
                }
            );
            
            if (response.status === 200) {
                this.isOnline = true;
                this.retryCount = 0;
                await this.syncData();
            }
        } catch (error) {
            console.error('Connection check failed:', {
                message: error.message
            });

            if (error.response?.status === 401) {
                console.log('Token expired, attempting to reauthenticate...');
                const isAuthenticated = await this.authenticate();
                if (isAuthenticated) {
                    await this.syncData();
                }
            } else {
                this.isOnline = false;
                
                if (this.retryCount < this.config.maxRetries) {
                    this.retryCount++;
                    const delay = this.getRetryDelay();
                    console.log(`Retry attempt ${this.retryCount} of ${this.config.maxRetries} in ${delay}ms`);
                    setTimeout(() => {
                        this.checkConnectionAndSync();
                    }, delay);
                } else {
                    console.error('Max retries reached');
                    this.config.onSyncError(new Error('Max retries reached'));
                }
            }
        }
    }
    async syncData() {
        if (!this.accessToken) {
            throw new Error('Not authenticated');
        }

        try {
            // Add detailed logging
            console.log('Starting sync operation...');
            
            const results = {
                notices: await this.syncNotices(),
                reports: await this.syncReports(),
		media: await this.syncMedia()
            };

            // Log detailed results
            //console.log('Detailed sync results:', JSON.stringify(results, null, 2));
            
            this.config.onSyncComplete(results);
            this.retryCount = 0;
            
            return results;
        } catch (error) {
            console.error('Sync failed:', {
                message: error.message
            });
            this.config.onSyncError(error);
            throw error;
        }
    }

   async syncNotices() {
        try {
            console.log('Reading local notices file...');
            const localData = await this.readLocalFile(this.localPaths.notices);
            const notices = localData.notices || [];
            
            if (notices.length === 0) {
                return { status: 'skipped', message: 'No local notices to sync' };
            }

            // Remove any existing id/_id fields, let MongoDB generate new ones
            const transformedNotices = notices.map(notice => {
                const { id, _id, ...noticeData } = notice;
                return noticeData;
            });

            const response = await axios.post(
                `${this.config.serverUrl}/api/notices/sync-local`,
                { notices: transformedNotices },
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );

            //console.log('Sync response:', response.data);
            return {
                status: 'success',
                synced: response.data.data
            };
        } catch (error) {
            console.error('Notice sync failed:', error);
            return {
                status: 'error',
                error: error.message,
                details: error.response?.data
            };
        }
    }

    async syncReports() {
    try {
        console.log('Reading local reports file...');
        const localData = await this.readLocalFile(this.localPaths.reports);
        const reports = localData.reports || [];
        
        console.log(`Found ${reports.length} local reports to sync`);
        
        if (reports.length === 0) {
            return { status: 'skipped', message: 'No local reports to sync' };
        }

        // Remove any existing id/_id fields, let MongoDB generate new ones
        const transformedReports = reports.map(report => { 
            const { id, _id, ...reportData } = report;
            return reportData;
        });

        //console.log('Sending transformed reports to server:', 
            //JSON.stringify(transformedReports[0], null, 2)); // Log first report as example

        const response = await axios.post(
            `${this.config.serverUrl}/api/reports/sync-local`,
            { reports: transformedReports },
            {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        //console.log('Server response:', JSON.stringify(response.data, null, 2));

        return {
            status: 'success',
            synced: response.data.data
        };
    } catch (error) {
        console.error('Report sync failed:', {
            message: error.message
        });
        return {
            status: 'error',
            error: error.message

        };
    }
}

    async readLocalFile(filePath) {
        try {
            //console.log(`Reading local file: ${filePath}`);
            const data = await fs.readFile(filePath, 'utf8');
            const parsedData = JSON.parse(data);
        /*    console.log(`Successfully read local file. Found ${
                (parsedData.notices || []).length} notices and ${
                (parsedData.reports || []).length} reports`);*/
            return parsedData;
        } catch (error) {
            if (error.code === 'ENOENT') {
                //console.log(`No local file found at ${filePath}, returning empty data`);
                return { notices: [], reports: [] };
            }
            console.error(`Error reading local file ${filePath}:`, error);
            throw error;
        }
    }

   async syncMedia() {
    try {
        //console.log('Reading local media file...');
        const localData = await this.readLocalFile(this.localPaths.media);
        const media = localData.media || [];
        
        if (media.length === 0) {
            return { status: 'skipped', message: 'No local media to sync' };
        }

        // Remove any existing id/_id fields
        const transformedMedia = media.map(item => {
            const { id, _id, ...mediaData } = item;
            return mediaData;
        });

        const response = await axios.post(
            `${this.config.serverUrl}/api/media/sync-local`,
            { media: transformedMedia },
            {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

//console.log('Media sync response:', response.data);
        return {
            status: 'success'
        };
    } catch (error) {
        console.error('Media sync failed:', error);
        return {
            status: 'error',
            error: error.message
        };
    }
}
}


module.exports = AuthSyncService;

