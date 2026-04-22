require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const { getDb } = require('./db');

process.on('uncaughtException', (err) => {
    console.error('[CRITICAL ERROR] Uncaught Exception:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
    console.error('[CRITICAL ERROR] Unhandled Rejection:', reason);
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

const sessions = new Map(); // token -> { id, role }

function jsonResponse(obj) { return JSON.stringify(obj); }

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
        req.on('error', reject);
    });
}

const server = http.createServer((req, res) => {
    (async () => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-API-Key');
        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

        if (req.url.startsWith('/api/')) {
            const db = await getDb();
            const url = new URL(req.url, `http://localhost:${PORT}`);

            // ---- LOGIN ----
            if (req.method === 'POST' && url.pathname === '/api/login') {
                try {
                    const { email, password } = await parseBody(req);
                    const normalized = email.toLowerCase().trim();

                    const professors = await db.collection('professors').find({}).toArray();
                    const prof = professors.find(p =>
                        (p.email && p.email.toLowerCase().trim() === normalized) ||
                        (p.name && p.name.toLowerCase().trim() === normalized)
                    );
                    if (prof && prof.password === password) {
                        const token = 'token_' + Math.random().toString(36).substr(2);
                        sessions.set(token, { id: prof._id, role: 'professor' });
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(jsonResponse({ success: true, token, role: 'professor', apiKey: PROFESSOR_API_KEY, name: prof.name }));
                        return;
                    }

                    const students = await db.collection('students').find({}).toArray();
                    const student = students.find(s =>
                        (s.email && s.email.toLowerCase().trim() === normalized) ||
                        (s.name && s.name.toLowerCase().trim() === normalized)
                    );
                    if (student && student.password === password) {
                        const token = 'token_' + Math.random().toString(36).substr(2);
                        sessions.set(token, { id: student._id, role: 'student' });
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(jsonResponse({ success: true, token, role: 'student', apiKey: STUDENT_API_KEY, studentName: student.name }));
                        return;
                    }

                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(jsonResponse({ success: false, message: 'Invalid credentials' }));
                } catch (e) {
                    res.writeHead(400);
                    res.end(jsonResponse({ success: false, message: 'Bad Request' }));
                }
                return;
            }

            // ---- AUTH MIDDLEWARE ----
            const token = req.headers['authorization']?.split(' ')[1];
            const session = sessions.get(token);
            const apiKeyHeader = req.headers['x-api-key'];

            if (!session || (apiKeyHeader !== STUDENT_API_KEY && apiKeyHeader !== PROFESSOR_API_KEY)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(jsonResponse({ success: false, error: 'Unauthorized', details: 'Invalid Session.' }));
                return;
            }

            const { id: sessionId, role: sessionRole } = session;

            function parseApiPath(pathname, prefix) {
                if (!pathname.startsWith(prefix)) return null;
                return pathname.slice(prefix.length).split('/').filter(Boolean);
            }

            console.log(`[API Request] Method: ${req.method}, Path: ${url.pathname}`);

            try {
                // ============== OFFICE HOURS ==============
                const officeHoursParts = parseApiPath(url.pathname, '/api/professor/office-hours/');
                if (officeHoursParts) {
                    const rawCourseId = officeHoursParts[0];
                    const slotId = officeHoursParts[1];

                    if (!rawCourseId) {
                        res.writeHead(400); res.end(jsonResponse({ success: false, error: 'Course ID missing' }));
                        return;
                    }

                    const courseId = rawCourseId.toString().trim().replace(/\s+/g, '');

                    if (req.method === 'GET') {
                        const professors = await db.collection('professors').find({}).toArray();
                        const prof = professors.find(p => p.courses && (p.courses.includes(courseId) || p.courses.includes(rawCourseId)));
                        const ohDoc = await db.collection('office_hours').findOne({ _id: courseId });
                        const slots = ohDoc ? ohDoc.slots : [];
                        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
                        res.end(jsonResponse({ success: true, professorName: prof ? prof.name : 'Unassigned', slots }));
                        return;
                    }

                    if (sessionRole === 'professor') {
                        if (req.method === 'POST') {
                            const slot = await parseBody(req);
                            slot.id = Date.now().toString();
                            const ohDoc = await db.collection('office_hours').findOne({ _id: courseId });
                            const slots = ohDoc ? ohDoc.slots : [];
                            slots.push(slot);
                            await db.collection('office_hours').replaceOne({ _id: courseId }, { _id: courseId, slots }, { upsert: true });
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(jsonResponse({ success: true, slot }));
                            return;
                        }

                        if (req.method === 'DELETE') {
                            if (!slotId) {
                                res.writeHead(400); res.end(jsonResponse({ success: false, error: 'Slot ID missing' }));
                                return;
                            }
                            const ohDoc = await db.collection('office_hours').findOne({ _id: courseId });
                            const slots = ohDoc ? ohDoc.slots.filter(s => s.id !== slotId) : [];
                            await db.collection('office_hours').replaceOne({ _id: courseId }, { _id: courseId, slots }, { upsert: true });
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(jsonResponse({ success: true }));
                            return;
                        }
                    }
                }

                // ========== STUDENT ENDPOINTS ==========
                if (sessionRole === 'student') {
                    const currentStudent = await db.collection('students').findOne({ _id: sessionId });
                    if (!currentStudent) {
                        res.writeHead(404); res.end(jsonResponse({ error: 'Student not found' })); return;
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
                        const certDoc = await db.collection('cert_statuses').findOne({ _id: `${sessionId}_${courseId}` });
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(jsonResponse(certDoc || { status: 'pending' }));
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
                            t.courses.forEach(c => { csv += `${c.id},${t.name},${c.grade},${c.gp}\n`; });
                        });
                        res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=grades.csv' });
                        res.end(csv);
                    }
                    else if (url.pathname.startsWith('/api/chat/')) {
                        await handleChat(req, res, url, db, { id: currentStudent._id, name: currentStudent.name, role: 'student' });
                    }
                    else { res.writeHead(404); res.end(); }
                }

                // ========== PROFESSOR ENDPOINTS ==========
                else if (sessionRole === 'professor') {
                    const currentProf = await db.collection('professors').findOne({ _id: sessionId });
                    if (!currentProf) {
                        res.writeHead(404); res.end(jsonResponse({ error: 'Professor not found' })); return;
                    }

                    if (url.pathname === '/api/me') {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(jsonResponse(currentProf));
                    }
                    else if (req.method === 'PUT' && url.pathname.startsWith('/api/professor/cert/')) {
                        const parts = url.pathname.split('/');
                        const courseId = parts.pop();
                        const studentId = parts.pop();
                        const { status } = await parseBody(req);
                        const key = `${studentId}_${courseId}`;
                        await db.collection('cert_statuses').replaceOne(
                            { _id: key },
                            { _id: key, status, by: currentProf.name, at: new Date().toISOString() },
                            { upsert: true }
                        );
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(jsonResponse({ success: true }));
                    }
                    else if (req.method === 'GET' && url.pathname.startsWith('/api/professor/cert-status/')) {
                        const parts = url.pathname.split('/');
                        const courseId = parts.pop();
                        const studentId = parts.pop();
                        const certDoc = await db.collection('cert_statuses').findOne({ _id: `${studentId}_${courseId}` });
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(jsonResponse(certDoc || { status: 'pending' }));
                    }
                    else if (url.pathname.startsWith('/api/professor/roster/')) {
                        const courseId = url.pathname.split('/').pop();
                        const enrolled = await db.collection('students').find({ active_courses: courseId }).toArray();
                        const roster = enrolled.map(s => {
                            const allDates = s.trimesters.flatMap(t => t.courses)
                                .filter(c => c.id === courseId).flatMap(c => c.attendance || []);
                            const totalClasses = allDates.length;
                            const presentCount = allDates.filter(a => a.status === 'Present').length;
                            return {
                                id: s._id, name: s.name, cgpa: s.cgpa,
                                attendancePct: totalClasses > 0 ? Math.round((presentCount / totalClasses) * 100) : 0,
                                totalClasses, presentCount
                            };
                        });
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(jsonResponse(roster));
                    }
                    else if (url.pathname.startsWith('/api/professor/attendance/') && req.method === 'GET') {
                        const parts = url.pathname.split('/');
                        const courseId = parts.pop();
                        const studentId = parts.pop();
                        const student = await db.collection('students').findOne({ _id: studentId });
                        if (!student) { res.writeHead(404); res.end(); return; }
                        const allCourses = student.trimesters.flatMap(t => t.courses);
                        const course = allCourses.find(c => c.id === courseId);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(jsonResponse(course ? course.attendance : []));
                    }
                    else if (url.pathname.startsWith('/api/professor/attendance/') && req.method === 'PUT') {
                        const parts = url.pathname.split('/');
                        const dateIndex = parseInt(parts.pop());
                        const courseId = parts.pop();
                        const studentId = parts.pop();

                        const student = await db.collection('students').findOne({ _id: studentId });
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
                        if (found) await db.collection('students').replaceOne({ _id: studentId }, student);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(jsonResponse({ success: found }));
                    }
                    else if (url.pathname.startsWith('/api/chat/')) {
                        await handleChat(req, res, url, db, { id: currentProf._id, name: currentProf.name, role: 'professor' });
                    }
                }

            } catch (error) {
                console.error('API Error:', error);
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
                fs.readFile(path.join(__dirname, 'index.html'), (err2, html) => {
                    if (err2) { res.writeHead(404); res.end('Not Found'); }
                    else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html, 'utf-8'); }
                });
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content, 'utf-8');
            }
        });

    })().catch(err => {
        console.error('Request handler error:', err);
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(jsonResponse({ error: 'Internal Server Error' }));
        }
    });
});

async function handleChat(req, res, url, db, sender) {
    const parts = url.pathname.split('/');
    const type = parts.pop();
    const courseId = parts.pop();

    if (req.method === 'GET') {
        const messages = await db.collection('chats')
            .find({ courseId, chatType: type })
            .sort({ timestamp: 1 })
            .toArray();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(jsonResponse(messages));
    } else if (req.method === 'POST') {
        const body = await parseBody(req);
        const message = {
            text: body.text,
            studentId: sender.id,
            studentName: sender.name,
            role: sender.role,
            timestamp: new Date().toISOString(),
            courseId,
            chatType: type
        };
        if (body.pinned) message.pinned = true;
        await db.collection('chats').insertOne(message);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(jsonResponse({ success: true, message }));
    }
}

server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use.`);
    else console.error('Server error:', e);
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`KreaAcademicHub Running at http://localhost:${PORT}/`);
    console.log(`Also available at http://127.0.0.1:${PORT}/`);
});
