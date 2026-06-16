# ClearPass Backend Foundation

ClearPass is a campus clearance workflow automation system for tertiary institutions. This backend handles user management, department-based clearance workflows, and automated approval sequencing.

## Tech Stack
- **Node.js** & **Express.js**
- **MongoDB** with **Mongoose**
- **JWT** for Authentication

## Project Structure
```text
clearpass-backend/
├── config/             # Configuration files (DB connection)
├── controllers/        # Business logic for routes
├── middleware/         # Custom Express middleware (Auth, RBAC)
├── models/             # Mongoose schemas
├── routes/             # API route definitions
├── utils/              # Helper functions
├── .env                # Environment variables
├── server.js           # Entry point
└── package.json        # Dependencies and scripts
```

## Workflow Logic
The system follows a sequential clearance path:
**Library → Bursary → Department → Student Affairs → Final Approval**

1. **Submission**: When a student submits a request, all approval steps are created automatically.
2. **Activation**: The first stage (Library) is set to `active`.
3. **Approval**: Once an officer approves, the current step is marked `approved`, and the next sequential step is set to `active`.
4. **Rejection**: If any stage is rejected, the entire workflow stops, and the request status becomes `rejected`.

## Setup
1. Install dependencies: `npm install`
2. Configure `.env` with your MongoDB URI and JWT Secret.
3. Start development server: `npm run dev`

## API Endpoints

### Authentication
- `POST /api/auth/register`: Register a new user (Student, Officer, Admin)
- `POST /api/auth/login`: Authenticate and receive JWT

### Clearance Requests (Student)
- `POST /api/requests`: Submit a new clearance request
- `GET /api/requests`: View status of your requests

### Officer Operations
- `GET /api/officer/queue`: View pending requests for your department
- `PUT /api/officer/approve/:stepId`: Approve a specific clearance step
- `PUT /api/officer/reject/:stepId`: Reject a specific clearance step
