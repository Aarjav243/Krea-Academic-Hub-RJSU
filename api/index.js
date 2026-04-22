const { getDb } = require('../db');

const STUDENT_API_KEY = "Krea-Hub-Secret-2026";
const PROFESSOR_API_KEY = "Krea-Prof-Secret-2026";

async function getSession(db, token) {
    if (!token) return null;
    return await db.collection('sessions').findOne({ _id: token }) || null;
}

async function saveSession(db, token, id, role) {
    await db.collection('sessions').replaceOne(
        { _id: token },
        { _id: token, id, role, createdAt: new Date() },
        { upsert: true }
    );
}

function sendJson(res, status, obj) {
    res.setHeader('Content-Type', 'application/json');
    res.status(status).send(JSON.stringify(obj));
}

function parseBody(req) {
    return new Promise((resolve, reject) => {
        if (req.body && typeof req.body === 'object') { resolve(req.body); return; }
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
        req.on('error', reject);
    });
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-API-Key');
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }

    const db = await getDb();
    const url = new URL(req.url, `http://${req.headers.host}`);

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
                const token = 'token_' + Math.random().toString(36).substring(2);
                await saveSession(db, token, prof._id, 'professor');
                sendJson(res, 200, { success: true, token, role: 'professor', apiKey: PROFESSOR_API_KEY, name: prof.name });
                return;
            }

            const students = await db.collection('students').find({}).toArray();
            const student = students.find(s =>
                (s.email && s.email.toLowerCase().trim() === normalized) ||
                (s.name && s.name.toLowerCase().trim() === normalized)
            );
            if (student && student.password === password) {
                const token = 'token_' + Math.random().toString(36).substring(2);
                await saveSession(db, token, student._id, 'student');
                sendJson(res, 200, { success: true, token, role: 'student', apiKey: STUDENT_API_KEY, studentName: student.name });
                return;
            }

            sendJson(res, 401, { success: false, message: 'Invalid credentials' });
        } catch (e) {
            sendJson(res, 400, { success: false, message: 'Bad Request' });
        }
        return;
    }

    // ---- AUTH MIDDLEWARE ----
    const tokenHeader = req.headers['authorization'];
    const token = tokenHeader ? tokenHeader.split(' ')[1] : null;
    const session = await getSession(db, token);
    const apiKeyHeader = req.headers['x-api-key'];

    if (!session || (apiKeyHeader !== STUDENT_API_KEY && apiKeyHeader !== PROFESSOR_API_KEY)) {
        sendJson(res, 401, { success: false, error: 'Unauthorized' });
        return;
    }

    const { id: sessionId, role: sessionRole } = session;

    function parseApiPath(pathname, prefix) {
        if (!pathname.startsWith(prefix)) return null;
        return pathname.slice(prefix.length).split('/').filter(Boolean);
    }

    try {
        // ============== OFFICE HOURS ==============
        const officeHoursParts = parseApiPath(url.pathname, '/api/professor/office-hours/');
        if (officeHoursParts) {
            const rawCourseId = officeHoursParts[0];
            const slotId = officeHoursParts[1];

            if (!rawCourseId) { sendJson(res, 400, { success: false, error: 'Course ID missing' }); return; }
            const courseId = rawCourseId.toString().trim().replace(/\s+/g, '');

            if (req.method === 'GET') {
                const professors = await db.collection('professors').find({}).toArray();
                const prof = professors.find(p => p.courses && (p.courses.includes(courseId) || p.courses.includes(rawCourseId)));
                const ohDoc = await db.collection('office_hours').findOne({ _id: courseId });
                sendJson(res, 200, { success: true, professorName: prof ? prof.name : 'Unassigned', slots: ohDoc ? ohDoc.slots : [] });
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
                    sendJson(res, 200, { success: true, slot });
                    return;
                }
                if (req.method === 'DELETE') {
                    if (!slotId) { sendJson(res, 400, { success: false, error: 'Slot ID missing' }); return; }
                    const ohDoc = await db.collection('office_hours').findOne({ _id: courseId });
                    const slots = ohDoc ? ohDoc.slots.filter(s => s.id !== slotId) : [];
                    await db.collection('office_hours').replaceOne({ _id: courseId }, { _id: courseId, slots }, { upsert: true });
                    sendJson(res, 200, { success: true });
                    return;
                }
            }
        }

        // ========== STUDENT ENDPOINTS ==========
        if (sessionRole === 'student') {
            const currentStudent = await db.collection('students').findOne({ _id: sessionId });
            if (!currentStudent) { sendJson(res, 404, { error: 'Student not found' }); return; }

            if (url.pathname === '/api/me') {
                sendJson(res, 200, currentStudent); return;
            }
            if (url.pathname === '/api/courses') {
                sendJson(res, 200, { courses: currentStudent.active_courses, trimesters: currentStudent.trimesters }); return;
            }
            if (url.pathname.startsWith('/api/cert-status/')) {
                const courseId = url.pathname.split('/').pop();
                const certDoc = await db.collection('cert_statuses').findOne({ _id: `${sessionId}_${courseId}` });
                sendJson(res, 200, certDoc || { status: 'pending' }); return;
            }
            if (url.pathname.startsWith('/api/attendance/')) {
                const courseId = url.pathname.split('/').pop();
                const allCourses = currentStudent.trimesters.flatMap(t => t.courses);
                const course = allCourses.find(c => c.id === courseId);
                if (course) sendJson(res, 200, course.attendance);
                else sendJson(res, 404, { error: 'Course not found' });
                return;
            }
            if (url.pathname === '/api/download/csv') {
                let csv = 'Course ID,Trimester,Grade,Grade Points\n';
                currentStudent.trimesters.forEach(t => {
                    t.courses.forEach(c => { csv += `${c.id},${t.name},${c.grade},${c.gp}\n`; });
                });
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', 'attachment; filename=grades.csv');
                res.status(200).send(csv); return;
            }
            if (url.pathname.startsWith('/api/chat/')) {
                return handleChat(req, res, url, db, { id: currentStudent._id, name: currentStudent.name, role: 'student' });
            }
        }

        // ========== PROFESSOR ENDPOINTS ==========
        if (sessionRole === 'professor') {
            const currentProf = await db.collection('professors').findOne({ _id: sessionId });
            if (!currentProf) { sendJson(res, 404, { error: 'Professor not found' }); return; }

            if (url.pathname === '/api/me') {
                sendJson(res, 200, currentProf); return;
            }
            if (req.method === 'PUT' && url.pathname.startsWith('/api/professor/cert/')) {
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
                sendJson(res, 200, { success: true }); return;
            }
            if (req.method === 'GET' && url.pathname.startsWith('/api/professor/cert-status/')) {
                const parts = url.pathname.split('/');
                const courseId = parts.pop();
                const studentId = parts.pop();
                const certDoc = await db.collection('cert_statuses').findOne({ _id: `${studentId}_${courseId}` });
                sendJson(res, 200, certDoc || { status: 'pending' }); return;
            }
            if (url.pathname.startsWith('/api/professor/roster/')) {
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
                sendJson(res, 200, roster); return;
            }
            if (url.pathname.startsWith('/api/professor/attendance/') && req.method === 'GET') {
                const parts = url.pathname.split('/');
                const courseId = parts.pop();
                const studentId = parts.pop();
                const student = await db.collection('students').findOne({ _id: studentId });
                if (!student) { res.status(404).end(); return; }
                const allCourses = student.trimesters.flatMap(t => t.courses);
                const course = allCourses.find(c => c.id === courseId);
                sendJson(res, 200, course ? course.attendance : []); return;
            }
            if (url.pathname.startsWith('/api/professor/attendance/') && req.method === 'PUT') {
                const parts = url.pathname.split('/');
                const dateIndex = parseInt(parts.pop());
                const courseId = parts.pop();
                const studentId = parts.pop();
                const student = await db.collection('students').findOne({ _id: studentId });
                if (!student) { res.status(404).end(); return; }
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
                sendJson(res, 200, { success: found }); return;
            }
            if (url.pathname.startsWith('/api/chat/')) {
                return handleChat(req, res, url, db, { id: currentProf._id, name: currentProf.name, role: 'professor' });
            }
        }

        sendJson(res, 404, { error: 'API Route Not Found' });

    } catch (error) {
        console.error('API Error:', error);
        sendJson(res, 500, { success: false, error: 'Internal Server Error' });
    }
};

async function handleChat(req, res, url, db, sender) {
    const parts = url.pathname.split('/');
    const type = parts.pop();
    const courseId = parts.pop();

    if (req.method === 'GET') {
        const messages = await db.collection('chats')
            .find({ courseId, chatType: type })
            .sort({ timestamp: 1 })
            .toArray();
        res.setHeader('Content-Type', 'application/json');
        res.status(200).send(JSON.stringify(messages));
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
        res.setHeader('Content-Type', 'application/json');
        res.status(200).send(JSON.stringify({ success: true, message }));
    }
}
