const http = require('http');
const fs = require('fs');
const path = require('path');

// Global Stability Handlers
process.on('uncaughtException', (err) => {
    console.error('[CRITICAL ERROR] Uncaught Exception:', err.message);
    console.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[CRITICAL ERROR] Unhandled Rejection at:', promise, 'reason:', reason);
});

const PORT = 3005;
const STUDENT_API_KEY = "Krea-Hub-Secret-2026";
const PROFESSOR_API_KEY = "Krea-Prof-Secret-2026";

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.svg': 'image/svg+xml'
};

// In-memory sessions
const sessions = new Map(); // token -> { id, role }

// Load student data
let students = [];
try {
    const data = fs.readFileSync(path.join(__dirname, 'data', 'students.json'), 'utf-8');
    students = JSON.parse(data);
    console.log(`Loaded ${students.length} students from data/students.json`);
} catch (e) {
    console.error("Failed to load students.json.", e);
}

// Load professor data
let professors = [];
try {
    const data = fs.readFileSync(path.join(__dirname, 'data', 'professors.json'), 'utf-8');
    professors = JSON.parse(data);
    console.log(`Loaded ${professors.length} professors from data/professors.json`);
} catch (e) {
    console.error("Failed to load professors.json.", e);
}

// Load certificate status
let certStatuses = {};
const certFilePath = path.join(__dirname, 'data', 'cert_status.json');
try {
    if (fs.existsSync(certFilePath)) {
        certStatuses = JSON.parse(fs.readFileSync(certFilePath, 'utf-8'));
    }
} catch (e) { console.error("Failed to load cert_status.json", e); }

function saveCertStatuses() {
    fs.writeFileSync(certFilePath, JSON.stringify(certStatuses, null, 4), 'utf-8');
}

function saveStudents() {
    fs.writeFileSync(path.join(__dirname, 'data', 'students.json'), JSON.stringify(students, null, 4), 'utf-8');
}

const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-API-Key');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // API Routes
    if (req.url.startsWith('/api/')) {
        const url = new URL(req.url, `http://localhost:${PORT}`);

        // ---- LOGIN ----
        if (req.method === 'POST' && url.pathname === '/api/login') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const { email, password } = JSON.parse(body);
                    console.log(`Login attempt: ${email}`);

                    // Check professors first
                    const prof = professors.find(p =>
                        (p.email && p.email.toLowerCase().trim() === email.toLowerCase().trim()) ||
                        (p.name && p.name.toLowerCase().trim() === email.toLowerCase().trim())
                    );
                    if (prof && prof.password === password) {
                        const token = 'token_' + Math.random().toString(36).substr(2);
                        sessions.set(token, { id: prof.id, role: 'professor' });
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(jsonResponse({ success: true, token, role: 'professor', apiKey: PROFESSOR_API_KEY, name: prof.name }));
                        return;
                    }

                    // Check students
                    const student = students.find(s =>
                        (s.email && s.email.toLowerCase().trim() === email.toLowerCase().trim()) ||
                        (s.name && s.name.toLowerCase().trim() === email.toLowerCase().trim())
                    );
                    if (student && student.password === password) {
                        const token = 'token_' + Math.random().toString(36).substr(2);
                        sessions.set(token, { id: student.id, role: 'student' });
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(jsonResponse({ success: true, token, role: 'student', apiKey: STUDENT_API_KEY, studentName: student.name }));
                        return;
                    }

                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(jsonResponse({ success: false, message: 'Invalid credentials' }));
                } catch (e) {
                    console.error('Login error:', e);
                    res.writeHead(400);
                    res.end(jsonResponse({ success: false, message: 'Bad Request' }));
                }
            });
            return;
        }

        // ---- AUTH MIDDLEWARE ----
        const token = req.headers['authorization']?.split(' ')[1];
        const session = sessions.get(token);
        const apiKeyHeader = req.headers['x-api-key'];

        if (!session || (apiKeyHeader !== STUDENT_API_KEY && apiKeyHeader !== PROFESSOR_API_KEY)) {
            console.warn(`[401 Unauthorized] Path: ${url.pathname}, Session: ${!!session}, APIKey Match: ${apiKeyHeader === STUDENT_API_KEY || apiKeyHeader === PROFESSOR_API_KEY}`);
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(jsonResponse({ success: false, error: 'Unauthorized', details: 'Invalid Session.' }));
            return;
        }

        const { id: sessionId, role: sessionRole } = session;

        function parseApiPath(pathname, prefix) {
            if (!pathname.startsWith(prefix)) return null;
            const parts = pathname.slice(prefix.length).split('/').filter(Boolean);
            console.log(`[parseApiPath] Match Found! Prefix: ${prefix}, Parts:`, parts);
            return parts;
        }

        console.log(`[API Request] Method: ${req.method}, Path: ${url.pathname}`);

        try {
            // ============== SHARED & OFFICE HOURS ENDPOINTS ==============
            
            // Office Hours Management
            const officeHoursParts = parseApiPath(url.pathname, '/api/professor/office-hours/');
            if (officeHoursParts) {
                // Schema: /api/professor/office-hours/:courseId OR /api/professor/office-hours/:courseId/:slotId
                const rawCourseId = officeHoursParts[0];
                const slotId = officeHoursParts[1];
                
                if (!rawCourseId) {
                    console.warn(`[Office Hours] Request with missing Course ID. Parts:`, officeHoursParts);
                    res.writeHead(400); res.end(jsonResponse({ success: false, error: 'Course ID missing' }));
                    return;
                }

                // Normalization: "DATA 201" -> "DATA201"
                const courseId = rawCourseId.toString().trim().replace(/\s+/g, '');
                console.log(`[Office Hours] Normalized: ${rawCourseId} -> ${courseId}`);

                const fileName = path.join(__dirname, 'data', 'office_hours', `${courseId}.json`);
                // Fallback check for "DATA 201.json" if "DATA201.json" doesn't exist
                const fallbackFileName = path.join(__dirname, 'data', 'office_hours', `${rawCourseId}.json`);
                const actualFileName = fs.existsSync(fileName) ? fileName : fallbackFileName;
                console.log(`[Office Hours] Attempting to use file: ${actualFileName}`);

                if (req.method === 'GET') {
                    const prof = professors.find(p => p.courses.includes(courseId) || p.courses.includes(rawCourseId));
                    let slots = [];
                    if (fs.existsSync(actualFileName)) {
                        try {
                            const data = fs.readFileSync(actualFileName, 'utf-8');
                            slots = data ? JSON.parse(data) : [];
                        } catch (e) { console.error(`[Office Hours] Read error: ${e.message}`); }
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
                    res.end(jsonResponse({ 
                        success: true, 
                        professorName: prof ? prof.name : 'Unassigned', 
                        slots 
                    }));
                    return;
                } 
                
                if (sessionRole === 'professor') {
                    if (req.method === 'POST') {
                        let body = '';
                        req.on('data', chunk => body += chunk);
                        req.on('end', () => {
                            try {
                                const slot = JSON.parse(body);
                                slot.id = Date.now().toString();
                                if (!fs.existsSync(path.join(__dirname, 'data', 'office_hours'))) {
                                    fs.mkdirSync(path.join(__dirname, 'data', 'office_hours'), { recursive: true });
                                }
                                // Use courseId (normalized) for saving new files to keep it clean
                                let slots = fs.existsSync(actualFileName) ? JSON.parse(fs.readFileSync(actualFileName, 'utf-8')) : [];
                                slots.push(slot);
                                fs.writeFileSync(actualFileName, JSON.stringify(slots, null, 2));
                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(jsonResponse({ success: true, slot }));
                            } catch (e) {
                                res.writeHead(400); res.end(jsonResponse({ success: false, error: e.message }));
                            }
                        });
                        return;
                    } 
                    
                    if (req.method === 'DELETE') {
                        if (!slotId) {
                            res.writeHead(400); res.end(jsonResponse({ success: false, error: 'Slot ID missing' }));
                            return;
                        }
                        let slots = fs.existsSync(actualFileName) ? JSON.parse(fs.readFileSync(actualFileName, 'utf-8')) : [];
                        const oldLen = slots.length;
                        slots = slots.filter(s => s.id !== slotId);
                        fs.writeFileSync(actualFileName, JSON.stringify(slots, null, 2));
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(jsonResponse({ success: true }));
                        return;
                    }
                }
            }

            // ========== STUDENT ENDPOINTS ==========
        if (sessionRole === 'student') {
            const currentStudent = students.find(s => s.id === sessionId);
            if (!currentStudent && sessionRole === 'student') {
                console.error(`[Server] Student not found in database for ID: ${sessionId}`);
                res.writeHead(404);
                res.end(jsonResponse({ error: 'Student not found' }));
                return;
            }

            if (url.pathname === '/api/me') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(jsonResponse(currentStudent));
            }
            else if (url.pathname === '/api/courses') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(jsonResponse({ courses: currentStudent.active_courses, trimesters: currentStudent.trimesters }));
            }
            else if (url.pathname.startsWith('/api/cert-status/')) {
                const courseId = url.pathname.split('/').pop();
                const key = `${sessionId}_${courseId}`;
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(jsonResponse(certStatuses[key] || { status: 'pending' }));
            }
            else if (url.pathname.startsWith('/api/attendance/')) {
                const courseId = url.pathname.split('/').pop();
                const allCourses = currentStudent.trimesters.flatMap(t => t.courses);
                const course = allCourses.find(c => c.id === courseId);
                if (course) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(jsonResponse(course.attendance));
                } else {
                    res.writeHead(404); res.end(jsonResponse({ error: 'Course not found' }));
                }
            }
            else if (url.pathname === '/api/download/csv') {
                let csv = 'Course ID,Trimester,Grade,Grade Points\n';
                currentStudent.trimesters.forEach(t => {
                    t.courses.forEach(c => {
                        csv += `${c.id},${t.name},${c.grade},${c.gp}\n`;
                    });
                });
                res.writeHead(200, {
                    'Content-Type': 'text/csv',
                    'Content-Disposition': 'attachment; filename=grades.csv'
                });
                res.end(csv);
            }
            else if (url.pathname.startsWith('/api/chat/')) {
                handleChat(req, res, url, currentStudent);
            }
            else {
                res.writeHead(404); res.end();
            }
        }

        // ========== PROFESSOR ENDPOINTS ==========
        else if (sessionRole === 'professor') {
            const currentProf = professors.find(p => p.id === sessionId);
            if (!currentProf) { // No need for `&& sessionRole === 'professor'` as we are already in this block
                console.error(`[Server] Professor not found in database for ID: ${sessionId}`);
                res.writeHead(404);
                res.end(jsonResponse({ error: 'Professor not found' }));
                return;
            }

            if (url.pathname === '/api/me') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(jsonResponse(currentProf));
            }
            else if (req.method === 'PUT' && url.pathname.startsWith('/api/professor/cert/')) {
                const parts = url.pathname.split('/');
                const courseId = parts.pop();
                const studentId = parts.pop();
                
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    try {
                        const { status } = JSON.parse(body);
                        const key = `${studentId}_${courseId}`;
                        certStatuses[key] = {
                            status,
                            by: currentProf.name,
                            at: new Date().toISOString()
                        };
                        saveCertStatuses();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(jsonResponse({ success: true }));
                    } catch (e) {
                        res.writeHead(400); res.end(jsonResponse({ success: false, error: e.message }));
                    }
                });
                return;
            }
            // GET cert status for a student (professor use): GET /api/professor/cert-status/:studentId/:courseId
            else if (req.method === 'GET' && url.pathname.startsWith('/api/professor/cert-status/')) {
                const parts = url.pathname.split('/');
                const courseId = parts.pop();
                const studentId = parts.pop();
                const key = `${studentId}_${courseId}`;
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(jsonResponse(certStatuses[key] || { status: 'pending' }));
            }

            // Roster: GET /api/professor/roster/:courseId
            else if (url.pathname.startsWith('/api/professor/roster/')) {
                const courseId = url.pathname.split('/').pop();
                const roster = students
                    .filter(s => s.active_courses && s.active_courses.includes(courseId))
                    .map(s => {
                        const allCourseDates = s.trimesters.flatMap(t => t.courses)
                            .filter(c => c.id === courseId)
                            .flatMap(c => c.attendance || []);
                        const totalClasses = allCourseDates.length;
                        const presentCount = allCourseDates.filter(a => a.status === 'Present').length;
                        const attendancePct = totalClasses > 0 ? Math.round((presentCount / totalClasses) * 100) : 0;
                        return {
                            id: s.id,
                            name: s.name,
                            cgpa: s.cgpa,
                            attendancePct,
                            totalClasses,
                            presentCount
                        };
                    });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(jsonResponse(roster));
            }

            // Attendance for a student in a course: GET /api/professor/attendance/:studentId/:courseId
            else if (url.pathname.startsWith('/api/professor/attendance/') && req.method === 'GET') {
                const parts = url.pathname.split('/');
                const courseId = parts.pop();
                const studentId = parts.pop();
                const student = students.find(s => s.id === studentId);
                if (!student) { res.writeHead(404); res.end(); return; }
                const allCourses = student.trimesters.flatMap(t => t.courses);
                const course = allCourses.find(c => c.id === courseId);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(jsonResponse(course ? course.attendance : []));
            }

            // Toggle attendance: PUT /api/professor/attendance/:studentId/:courseId/:dateIndex
            else if (url.pathname.startsWith('/api/professor/attendance/') && req.method === 'PUT') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    try {
                        const parts = url.pathname.split('/');
                        const dateIndex = parseInt(parts.pop());
                        const courseId = parts.pop();
                        const studentId = parts.pop();
                        const student = students.find(s => s.id === studentId);
                        if (!student) { res.writeHead(404); res.end(); return; }

                        let found = false;
                        student.trimesters.forEach(t => {
                            t.courses.forEach(c => {
                                if (c.id === courseId && c.attendance && c.attendance[dateIndex]) {
                                    c.attendance[dateIndex].status = c.attendance[dateIndex].status === 'Present' ? 'Absent' : 'Present';
                                    found = true;
                                }
                            });
                        });
                        if (found) saveStudents();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(jsonResponse({ success: found }));
                    } catch (e) {
                        res.writeHead(500); res.end(jsonResponse({ error: 'Failed to update attendance' }));
                    }
                });
            }
            // (GET Office Hours moved to Shared)

            // Chat (professors can also post): /api/chat/:courseId/:type
            else if (url.pathname.startsWith('/api/chat/')) {
                const profAsSender = {
                    id: currentProf.id,
                    name: currentProf.name,
                    role: 'professor'
                };
                handleChat(req, res, url, profAsSender);
            }

            }
        } catch (error) {
            console.error('Critical Server Error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(jsonResponse({ success: false, error: 'Internal Server Error', details: error.message }));
        }

        return;
    }

    // Static File Serving
    const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
    let filePath = path.join(__dirname, parsedUrl.pathname === '/' ? 'index.html' : parsedUrl.pathname);

    const extname = String(path.extname(filePath)).toLowerCase();
    const contentType = MIME_TYPES[extname] || 'text/html';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            // If file not found, fall back to index.html (SPA fallback)
            fs.readFile(path.join(__dirname, 'index.html'), (err2, html) => {
                if (err2) {
                    res.writeHead(404);
                    res.end('Not Found');
                } else {
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(html, 'utf-8');
                }
            });
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

function handleChat(req, res, url, sender) {
    const parts = url.pathname.split('/');
    const type = parts.pop();
    const courseId = parts.pop();
    const fileName = path.join(__dirname, 'data', 'chats', `${courseId}_${type}.json`);

    if (req.method === 'GET') {
        try {
            if (fs.existsSync(fileName)) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(fs.readFileSync(fileName, 'utf-8'));
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end('[]');
            }
        } catch (e) {
            res.writeHead(500); res.end(jsonResponse({ error: 'Failed to load chat' }));
        }
    } else if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const message = JSON.parse(body);
                message.studentId = sender.id;
                message.studentName = sender.name;
                message.role = sender.role || 'student';
                message.timestamp = new Date().toISOString();
                message.courseId = courseId;
                message.chatType = type;
                if (message.pinned) message.pinned = true;

                let chatData = [];
                if (fs.existsSync(fileName)) {
                    chatData = JSON.parse(fs.readFileSync(fileName, 'utf-8'));
                }
                chatData.push(message);
                fs.writeFileSync(fileName, JSON.stringify(chatData, null, 2));

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(jsonResponse({ success: true, message }));
            } catch (e) {
                res.writeHead(500); res.end(jsonResponse({ error: 'Failed to save message' }));
            }
        });
    }
}

function jsonResponse(obj) {
    return JSON.stringify(obj);
}

server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Please close the other process.`);
    } else {
        console.error('Server error:', e);
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`KreaAcademicHub Running at http://localhost:${PORT}/`);
    console.log(`Also available at http://127.0.0.1:${PORT}/`);
});
