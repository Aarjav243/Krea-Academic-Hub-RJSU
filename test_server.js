
const http = require('http');

const loginData = JSON.stringify({
    email: "aarjav_jain_krea.sias24@krea.ac.in",
    password: "password123"
});

const loginOptions = {
    hostname: 'localhost',
    port: 3005,
    path: '/api/login',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': loginData.length
    }
};

const req = http.request(loginOptions, (res) => {
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => {
        console.log('Login Response:', body);
        const data = JSON.parse(body);
        if (data.success) {
            const token = data.token;
            const apiKey = data.apiKey;
            testApiMe(token, apiKey);
        }
    });
});

req.on('error', (e) => {
    console.error(`Login Request Error: ${e.message}`);
});

req.write(loginData);
req.end();

function testApiMe(token, apiKey) {
    const options = {
        hostname: 'localhost',
        port: 3005,
        path: '/api/me',
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'X-API-Key': apiKey
        }
    };

    http.get(options, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
            console.log('API /me Response:', body);
            testApiOfficeHours(token, apiKey);
        });
    }).on('error', (e) => {
        console.error(`API /me Error: ${e.message}`);
    });
}

function testApiOfficeHours(token, apiKey) {
    const options = {
        hostname: 'localhost',
        port: 3005,
        path: '/api/professor/office-hours/DATA201',
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'X-API-Key': apiKey
        }
    };

    http.get(options, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
            console.log('API Office Hours Response:', body);
        });
    }).on('error', (e) => {
        console.error(`API Office Hours Error: ${e.message}`);
    });
}
