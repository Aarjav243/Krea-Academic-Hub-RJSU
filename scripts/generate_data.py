import json
import random
import os

# Configuration
NUM_STUDENTS = 20
BATCH = "sias24"
MAJORS = ["Data Science", "Economics", "Biology", "Physics", "Computer Science"]
MINORS = ["Economics", "Psychology", "History", "Mathematics", "Environmental Studies"]

GRADE_POINTS = {
    "A+": 10.0, "A": 9.6, "A-": 9.2,
    "B+": 8.7, "B": 8.3, "B-": 7.9,
    "C+": 7.4, "C": 7.0, "C-": 6.6,
    "D": 5.0, "F": 0.0
}

# Real Krea course codes requested earlier
COURSE_POOL = [
    "DATA201", "DATA202", "DATA233", "DATA234", "DATA205", 
    "ECON202", "ECON201", "DATA223", "CS101", "MATH101", 
    "ENG101", "BIOL101", "PHYS101", "PSY101", "HIST101"
]

FIRST_NAMES = ["Aarjav", "Ananya", "Rohan", "Sanya", "Vikram", "Ishita", "Arjun", "Kavya", "Rahul", "Priya", "Sahil", "Meera", "Aditya", "Sneha", "Kabir", "Zara", "Dev", "Kyra", "Aryan", "Dia"]
LAST_NAMES = ["Jain", "Patel", "Sharma", "Gupta", "Malhotra", "Verma", "Singh", "Reddy", "Iyer", "Kapoor", "Chopra", "Das", "Mehta", "Bose", "Khan", "Gill", "Puri", "Joshi", "Bhat", "Shah"]

def generate_attendance():
    records = []
    # Generate 10 demo classes
    dates = [f"2026-03-{i+1:02d}" for i in range(10)]
    days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
    
    for i in range(10):
        status = "Present" if random.random() > 0.15 else "Absent"
        records.append({
            "day": days[i],
            "date": dates[i],
            "status": status
        })
    return records

def generate_students():
    students = []
    
    for i in range(NUM_STUDENTS):
        first = FIRST_NAMES[i % len(FIRST_NAMES)]
        last = LAST_NAMES[i % len(LAST_NAMES)]
        email = f"{first.lower()}_{last.lower()}_krea.{BATCH}@krea.ac.in"
        
        major = random.choice(MAJORS)
        minor = random.choice(MINORS)
        
        # Ensure some variety in credit progress
        major_credits = random.randint(20, 60)
        minor_credits = random.randint(12, 28)
        kccs_credits = random.choice([40, 44, 48])
        
        # Assign 6 default courses for grade breakdown
        student_courses = random.sample(COURSE_POOL, 6)
        trimester_1 = []
        trimester_2 = []
        
        all_grades = []
        for j, course in enumerate(student_courses):
            grade_code = random.choice(list(GRADE_POINTS.keys())[:5]) # Mostly A and B
            gp = GRADE_POINTS[grade_code]
            all_grades.append(gp)
            
            course_obj = {
                "id": course,
                "grade": grade_code,
                "gp": gp,
                "attendance": generate_attendance()
            }
            
            if j < 3: trimester_1.append(course_obj)
            else: trimester_2.append(course_obj)
            
        avg_t1 = round(sum(c["gp"] for c in trimester_1) / 3, 2)
        avg_t2 = round(sum(c["gp"] for c in trimester_2) / 3, 2)
        cgpa = round((avg_t1 + avg_t2) / 2, 2)
        
        students.append({
            "id": f"K{1000 + i}",
            "name": f"{first} {last}",
            "email": email,
            "password": "password123", # Default password for all
            "major": major,
            "minor": minor,
            "credits": {
                "major": {"current": major_credits, "target": 80},
                "minor": {"current": minor_credits, "target": 32},
                "kccs": {"current": kccs_credits, "target": 48}
            },
            "cgpa": cgpa,
            "trimesters": [
                {"name": "Trimester 1", "avg": avg_t1, "courses": trimester_1},
                {"name": "Trimester 2", "avg": avg_t2, "courses": trimester_2}
            ],
            "active_courses": student_courses # These will show on the dashboard grid
        })
        
    return students

if __name__ == "__main__":
    os.makedirs("data", exist_ok=True)
    data = generate_students()
    with open("data/students.json", "w") as f:
        json.dump(data, f, indent=4)
    print(f"Successfully generated {NUM_STUDENTS} students in data/students.json")
