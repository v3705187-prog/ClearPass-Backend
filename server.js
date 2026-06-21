const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

dotenv.config();

// ─── Connect DB ───────────────────────────────────────────────
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};
connectDB();

// ─── Models ───────────────────────────────────────────────────
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  matricNumber: { type: String, unique: true, sparse: true },
  role: { type: String, enum: ['student', 'officer', 'admin'], default: 'student' },
  department: { type: mongoose.Schema.ObjectId, ref: 'Department' },
  password: { type: String, required: true, minlength: 6, select: false },
  createdAt: { type: Date, default: Date.now },
});
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});
UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};
const User = mongoose.model('User', UserSchema);

const DepartmentSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  description: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
const Department = mongoose.model('Department', DepartmentSchema);

const ClearanceRequestSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
  currentStage: { type: String, default: 'Library' },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  submittedAt: { type: Date, default: Date.now },
  completedAt: { type: Date },
});
const ClearanceRequest = mongoose.model('ClearanceRequest', ClearanceRequestSchema);

const ApprovalStepSchema = new mongoose.Schema({
  requestId: { type: mongoose.Schema.ObjectId, ref: 'ClearanceRequest', required: true },
  departmentId: { type: mongoose.Schema.ObjectId, ref: 'Department', required: true },
  officerId: { type: mongoose.Schema.ObjectId, ref: 'User' },
  stageOrder: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'active', 'approved', 'rejected'], default: 'pending' },
  comments: { type: String },
  approvedAt: { type: Date },
});
const ApprovalStep = mongoose.model('ApprovalStep', ApprovalStepSchema);

// ─── Middleware ───────────────────────────────────────────────
const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) return res.status(401).json({ success: false, message: 'Not authorized' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id);
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Not authorized' });
  }
};

const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: `Role ${req.user.role} not authorized` });
  }
  next();
};

const sendToken = (user, statusCode, res) => {
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE });
  res.status(statusCode).json({ success: true, token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
};

// ─── App ──────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(cors());

// ─── Auth Routes ──────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role, matricNumber, department } = req.body;
    const user = await User.create({ name, email, password, role, matricNumber, department });
    sendToken(user, 201, res);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'Please provide email and password' });
    const user = await User.findOne({ email }).select('+password');
    if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    const isMatch = await user.matchPassword(password);
    if (!isMatch) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    sendToken(user, 200, res);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─── Request Routes ───────────────────────────────────────────
const WORKFLOW_STAGES = ['Library', 'Bursary', 'Department', 'Student Affairs', 'Final Approval'];

app.post('/api/requests', protect, authorize('student'), async (req, res) => {
  try {
    const existing = await ClearanceRequest.findOne({ studentId: req.user.id, status: { $in: ['pending', 'approved'] } });
    if (existing) return res.status(400).json({ success: false, message: 'You already have an active clearance request' });
    const request = await ClearanceRequest.create({ studentId: req.user.id, currentStage: WORKFLOW_STAGES[0], status: 'pending' });
    for (let i = 0; i < WORKFLOW_STAGES.length; i++) {
      let dept = await Department.findOne({ name: WORKFLOW_STAGES[i] });
      if (!dept) dept = await Department.create({ name: WORKFLOW_STAGES[i], description: `${WORKFLOW_STAGES[i]} Clearance` });
      await ApprovalStep.create({ requestId: request._id, departmentId: dept._id, stageOrder: i, status: i === 0 ? 'active' : 'pending' });
    }
    res.status(201).json({ success: true, data: request });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.get('/api/requests', protect, authorize('student', 'admin'), async (req, res) => {
  try {
    const requests = await ClearanceRequest.find({ studentId: req.user.id });
    const withSteps = await Promise.all(requests.map(async (r) => {
      const steps = await ApprovalStep.find({ requestId: r._id }).populate('departmentId', 'name').sort('stageOrder');
      return { ...r._doc, steps };
    }));
    res.status(200).json({ success: true, data: withSteps });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─── Officer Routes ───────────────────────────────────────────
app.get('/api/officer/queue', protect, authorize('officer', 'admin'), async (req, res) => {
  try {
    const queue = await ApprovalStep.find({ departmentId: req.user.department, status: 'active' })
      .populate({ path: 'requestId', populate: { path: 'studentId', select: 'name email matricNumber' } });
    res.status(200).json({ success: true, count: queue.length, data: queue });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.put('/api/officer/approve/:stepId', protect, authorize('officer', 'admin'), async (req, res) => {
  try {
    const step = await ApprovalStep.findById(req.params.stepId);
    if (!step) return res.status(404).json({ success: false, message: 'Step not found' });
    if (step.departmentId.toString() !== req.user.department.toString()) return res.status(403).json({ success: false, message: 'Not authorized for this department' });
    step.status = 'approved'; step.officerId = req.user.id; step.approvedAt = Date.now(); step.comments = req.body.comments;
    await step.save();
    const nextStep = await ApprovalStep.findOne({ requestId: step.requestId, stageOrder: step.stageOrder + 1 });
    const request = await ClearanceRequest.findById(step.requestId);
    if (nextStep) {
      nextStep.status = 'active'; await nextStep.save();
      const populated = await nextStep.populate('departmentId');
      request.currentStage = populated.departmentId.name; await request.save();
    } else {
      request.status = 'approved'; request.completedAt = Date.now(); request.currentStage = 'Completed'; await request.save();
    }
    res.status(200).json({ success: true, message: 'Step approved' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.put('/api/officer/reject/:stepId', protect, authorize('officer', 'admin'), async (req, res) => {
  try {
    const step = await ApprovalStep.findById(req.params.stepId);
    if (!step) return res.status(404).json({ success: false, message: 'Step not found' });
    if (step.departmentId.toString() !== req.user.department.toString()) return res.status(403).json({ success: false, message: 'Not authorized' });
    step.status = 'rejected'; step.officerId = req.user.id; step.comments = req.body.comments || 'Rejected';
    await step.save();
    const request = await ClearanceRequest.findById(step.requestId);
    request.status = 'rejected'; request.completedAt = Date.now(); await request.save();
    res.status(200).json({ success: true, message: 'Step rejected' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
