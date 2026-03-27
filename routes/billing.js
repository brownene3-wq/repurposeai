const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { userOps } = require('../db/database');
const { getBaseCSS, getHeadHTML, getSidebar, getThemeToggle, getThemeScript } = require('../utils/theme');
const STRIPE_KEY = process.env.STRIPE_PU@¥ÉM!H,OKEY || '';
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
