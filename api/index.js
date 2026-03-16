const fs = require('fs');
const path = require('path');

const STUDENT_API_KEY = "Krea-Hub-Secret-2026";
const PROFESSOR_API_KEY = "Krea-Prof-Secret-2026";

// In-memory sessions (Note: this will reset every time the Vercel serverless function spins up or down)
const sessions = new Map();

// Helper to safely read JSON from disk (read-only is fine on Vercel)
function loadDataFile(filename) {
    try {
        const filepath = path.join(__dirname, '..', 'data', filename);
        if (fs.existsSync(filepath)) {
            return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
        }
        return null;
    } catch (e) {
        console.error(`Error reading ${filename}:`, e.message);
        return null;
    }
}

function jsonResponse(obj) {
    return JSON.stringify(obj);
}

// ---------------------------------------------------------
// Vercel Serverless Function Handler
// ---------------------------------------------------------
module.exports = async (req, res) => {
    
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-API-Key');
    
    if (req.method === 'OPTIONS') { 
        res.status(204).end(); 
        return; 
    }

    // Load fresh data for every request since memory isn't fully persistent
    const students = loadDataFile('students.json') || [];
    const professors = loadDataFile('professors.json') || [];
    const certStatuses = loadDataFile('cert_status.json') || {};

    const url = new URL(req.url, `http://${req.headers.host}`);

    // ---- LOGIN ----
    if (req.method === 'POST' && url.pathname === '/api/login') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { email, password } = JSON.parse(body);
                
                // Check professors first
                const prof = professors.find(p =>
                    (p.email && p.email.toLowerCase().trim() === email.toLowerCase().trim()) ||
                    (p.name && p.name.toLowerCase().trim() === email.toLowerCase().trim())
                );
                if (prof && prof.password === password) {
                    const token = 'token_' + Math.random().toString(36).substr(2);
                    sessions.set(token, { id: prof.id, role: 'professor' });
                    res.setHeader('Content-Type', 'application/json');
                    res.status(200).send(jsonResponse({ success: true, token, role: 'professor', apiKey: PROFESSOR_API_KEY, name: prof.name }));
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
                    res.setHeader('Content-Type', 'application/json');
                    res.status(200).send(jsonResponse({ success: true, token, role: 'student', apiKey: STUDENT_API_KEY, studentName: student.name }));
                    return;
                }

                res.setHeader('Content-Type', 'application/json');
                res.status(401).send(jsonResponse({ success: false, message: 'Invalid credentials' }));
            } catch (e) {
                res.status(400).send(jsonResponse({ success: false, message: 'Bad Request' }));
            }
        });
        return;
    }

    // ---- AUTH MIDDLEWARE ----
    const tokenHeader = req.headers['authorization'];
    const token = tokenHeader ? tokenHeader.split(' ')[1] : null;
    const session = sessions.get(token);
    const apiKeyHeader = req.headers['x-api-key'];

    if (!session || (apiKeyHeader !== STUDENT_API_KEY && apiKeyHeader !== PROFESSOR_API_KEY)) {
        res.setHeader('Content-Type', 'application/json');
        res.status(401).send(jsonResponse({ success: false, error: 'Unauthorized', details: 'Invalid Session or API Key.' }));
        return;
    }

    const { id: sessionId, role: sessionRole } = session;

    // Helper to extract path parts
    function parseApiPath(pathname, prefix) {
        if (!pathname.startsWith(prefix)) return null;
        return pathname.slice(prefix.length).split('/').filter(Boolean);
    }

    try {
        // ============== SHARED ENDPOINTS ==============
        
        // Office Hours Management
        const officeHoursParts = parseApiPath(url.pathname, '/api/professor/office-hours/');
        if (officeHoursParts) {
            const rawCourseId = officeHoursParts[0];
            const slotId = officeHoursParts[1];
            
            if (!rawCourseId) {
                res.status(400).send(jsonResponse({ success: false, error: 'Course ID missing' }));
                return;
            }

            const courseId = rawCourseId.toString().trim().replace(/\s+/g, '');
            const actualFileName = path.join(__dirname, '..', 'data', 'office_hours', `${courseId}.json`);

            if (req.method === 'GET') {
                const prof = professors.find(p => p.courses.includes(courseId) || p.courses.includes(rawCourseId));
                let slots = [];
                if (fs.existsSync(actualFileName)) {
                    slots = JSON.parse(fs.readFileSync(actualFileName, 'utf-8'));
                }
                res.setHeader('Content-Type', 'application/json');
                res.status(200).send(jsonResponse({ success: true, professorName: prof ? prof.name : 'Unassigned', slots }));
                return;
            } 
            
            // Note: POST/DELETE will fail on Vercel long-term because it's a read-only FS,
            // but we mock success so the frontend doesn't crash during the demo.
            if (sessionRole === 'professor') {
                if (req.method === 'POST') {
                    let body = '';
                    req.on('data', chunk => body += chunk);
                    req.on('end', () => {
                        const slot = JSON.parse(body);
                        slot.id = Date.now().toString();
                        res.status(200).send(jsonResponse({ success: true, slot, note: "Vercel Read-Only Mock" }));
                    });
                    return;
                } 
                if (req.method === 'DELETE') {
                    res.status(200).send(jsonResponse({ success: true, note: "Vercel Read-Only Mock" }));
                    return;
                }
            }
        }

        // ========== STUDENT ENDPOINTS ==========
        if (sessionRole === 'student') {
            const currentStudent = students.find(s => s.id === sessionId);
            if (!currentStudent) {
                res.status(404).send(jsonResponse({ error: 'Student not found' }));
                return;
            }

            if (url.pathname === '/api/me') {
                res.status(200).send(jsonResponse(currentStudent));
                return;
            }
            if (url.pathname === '/api/courses') {
                res.status(200).send(jsonResponse({ courses: currentStudent.active_courses, trimesters: currentStudent.trimesters }));
                return;
            }
            if (url.pathname.startsWith('/api/cert-status/')) {
                const courseId = url.pathname.split('/').pop();
                const key = `${sessionId}_${courseId}`;
                res.status(200).send(jsonResponse(certStatuses[key] || { status: 'pending' }));
                return;
            }
            if (url.pathname.startsWith('/api/attendance/')) {
                const courseId = url.pathname.split('/').pop();
                const allCourses = currentStudent.trimesters.flatMap(t => t.courses);
                const course = allCourses.find(c => c.id === courseId);
                if (course) {
                    res.status(200).send(jsonResponse(course.attendance));
                } else {
                    res.status(404).send(jsonResponse({ error: 'Course not found' }));
                }
                return;
            }
            if (url.pathname === '/api/download/csv') {
                let csv = 'Course ID,Trimester,Grade,Grade Points\n';
                currentStudent.trimesters.forEach(t => {
                    t.courses.forEach(c => {
                        csv += `${c.id},${t.name},${c.grade},${c.gp}\n`;
                    });
                });
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', 'attachment; filename=grades.csv');
                res.status(200).send(csv);
                return;
            }
            if (url.pathname.startsWith('/api/chat/')) {
                return handleChatVercel(req, res, url, currentStudent);
            }
        }

        // ========== PROFESSOR ENDPOINTS ==========
        if (sessionRole === 'professor') {
            const currentProf = professors.find(p => p.id === sessionId);
            if (!currentProf) {
                res.status(404).send(jsonResponse({ error: 'Professor not found' }));
                return;
            }

            if (url.pathname === '/api/me') {
                res.status(200).send(jsonResponse(currentProf));
                return;
            }
            if (req.method === 'PUT' && url.pathname.startsWith('/api/professor/cert/')) {
                res.status(200).send(jsonResponse({ success: true, note: "Vercel Read-Only Mock" }));
                return;
            }
            if (req.method === 'GET' && url.pathname.startsWith('/api/professor/cert-status/')) {
                const parts = url.pathname.split('/');
                const courseId = parts.pop();
                const studentId = parts.pop();
                const key = `${studentId}_${courseId}`;
                res.status(200).send(jsonResponse(certStatuses[key] || { status: 'pending' }));
                return;
            }
            if (url.pathname.startsWith('/api/professor/roster/')) {
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
                res.status(200).send(jsonResponse(roster));
                return;
            }
            if (url.pathname.startsWith('/api/professor/attendance/') && req.method === 'GET') {
                const parts = url.pathname.split('/');
                const courseId = parts.pop();
                const studentId = parts.pop();
                const student = students.find(s => s.id === studentId);
                if (!student) { res.status(404).send(); return; }
                const allCourses = student.trimesters.flatMap(t => t.courses);
                const course = allCourses.find(c => c.id === courseId);
                res.status(200).send(jsonResponse(course ? course.attendance : []));
                return;
            }
            if (url.pathname.startsWith('/api/professor/attendance/') && req.method === 'PUT') {
                // Mock success for attendance toggle
                res.status(200).send(jsonResponse({ success: true, note: "Vercel Read-Only Mock" }));
                return;
            }
            if (url.pathname.startsWith('/api/chat/')) {
                const profAsSender = { id: currentProf.id, name: currentProf.name, role: 'professor' };
                return handleChatVercel(req, res, url, profAsSender);
            }
        }

        // If no route matches
        res.status(404).send(jsonResponse({ error: "API Route Not Found" }));

    } catch (error) {
        console.error('API Error:', error);
        res.status(500).send(jsonResponse({ success: false, error: 'Internal Server Error' }));
    }
};

function handleChatVercel(req, res, url, sender) {
    const parts = url.pathname.split('/');
    const type = parts.pop();
    const courseId = parts.pop();
    const fileName = path.join(__dirname, '..', 'data', 'chats', `${courseId}_${type}.json`);

    if (req.method === 'GET') {
        try {
            if (fs.existsSync(fileName)) {
                res.status(200).send(fs.readFileSync(fileName, 'utf-8'));
            } else {
                res.status(200).send('[]');
            }
        } catch (e) {
            res.status(500).send(jsonResponse({ error: 'Failed to load chat' }));
        }
    } else if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            const message = JSON.parse(body);
            message.studentId = sender.id;
            message.studentName = sender.name;
            message.role = sender.role || 'student';
            message.timestamp = new Date().toISOString();
            message.courseId = courseId;
            message.chatType = type;
            if (message.pinned) message.pinned = true;

            // Mock success for Vercel read-only FS
            res.status(200).send(jsonResponse({ success: true, message, note: "Vercel Read-Only Mock" }));
        });
    }
}
