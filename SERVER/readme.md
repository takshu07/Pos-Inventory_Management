Authentication-
->Employee
->Manager
->Admin

Register->
Receive data
Validate input
Check if email already exists
Hash password with bcrypt
Save employee
Return success

Login->
Find employee by email
Compare password
Generate JWT
Return token

Me->
Read JWT
Verify token
Find employee
Return employee details

Client
   │
POST /login
   │
Controller
   │
Service
   │
Database
   │
Check Password
   │
Generate JWT
   │
Return Token
   │
Client Stores Token
   │
Authorization: Bearer <token>
   │
Protected Route
   │
JWT Middleware
   │
Controller


What is the input?
What should happen?
What can go wrong?
What should be returned?
Only then write code.