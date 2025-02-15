const express = require('express');
const multer = require('multer');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs'); // Import bcrypt
const path = require('path'); // To handle file extension
const app = express();
const PORT = 3000;
const axios = require('axios');

// const doctorsRoutes = require('./doctors'); // Import the doctors route file
const dotnenv = require('dotenv');
dotnenv.config()
const cors = require('cors');
app.use(cors());
const GOOGLE_TRANSLATION_API_KEY = process.env.GOOGLE_TRANSLATION_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Configure multer for profile pictures with validation and renaming to .jpg
const storage = multer.diskStorage({                  
    destination: (req, file, cb) => {
        cb(null, 'uploads/'); // Set upload directory
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '.jpg'); // Store files as .jpg
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // Limit to 5MB
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Only image files are allowed.'));
        }
        cb(null, true);
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).send('File upload error: ' + err.message);
    } else if (err) {
        return res.status(400).send(err.message);
    }
    next();
});

// MySQL connection
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

db.connect(err => {
    if (err) throw err;
    console.log('Connected to MySQL!');
});

app.use(express.json());


// Utility function to format timestamp properly
const getFormattedTimestamp = () => {
    return new Date().toISOString().slice(0, 19).replace("T", " ");
};

// Function to retry requests in case of rate limits

// Retry logic for API requests
const retryRequest = async (url, data, headers, retries = 3, delay = 1000) => {
    try {
        const response = await axios.post(url, data, { headers });
        return response;
    } catch (error) {
        if (error.response && error.response.status === 429 && retries > 0) {
            console.log(`Rate limit exceeded. Retrying in ${delay / 1000} seconds...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
            return retryRequest(url, data, headers, retries - 1, delay * 2);
        }
        throw error;
    }
};

// Detect & Translate
app.post("/detect-and-translate", async (req, res) => {
    const { text, targetLanguage } = req.body;

    if (!text || !targetLanguage) {
        return res.status(400).json({ error: "Both 'text' and 'targetLanguage' are required." });
    }

    try {
        // Detect language
        const detectUrl = `https://translation.googleapis.com/language/translate/v2/detect?key=${process.env.GOOGLE_TRANSLATION_API_KEY}`;
        const detectResponse = await axios.post(detectUrl, { q: text });
        const detectedLanguage = detectResponse.data.data.detections[0][0].language;

        // Translate text
        const translateUrl = `https://translation.googleapis.com/language/translate/v2?key=${process.env.GOOGLE_TRANSLATION_API_KEY}`;
        const translateResponse = await axios.post(translateUrl, {
            q: text,
            source: detectedLanguage,
            target: targetLanguage,
            format: "text",
        });

        const translatedText = translateResponse.data.data.translations[0].translatedText;
        const timestamp = getFormattedTimestamp();

        db.query(
            "INSERT INTO notes (timestamp, original_text, translated_text) VALUES (?, ?, ?)",
            [timestamp, text, translatedText],
            (err) => {
                if (err) {
                    console.error("Error inserting into MySQL:", err);
                    return res.status(500).json({ error: "Database error" });
                }
                res.json({ detectedLanguage, translatedText });
            }
        );
    } catch (error) {
        console.error("Error in translation or detection:", error);
        res.status(500).json({ error: "An error occurred during language detection or translation." });
    }
});

app.post("/generate-prescription", async (req, res) => {
    const { text } = req.body;

    if (!text) {
        return res.status(400).json({ error: "Text input is required" });
    }

    try {
        const response = await axios.post(
            "https://api.openai.com/v1/chat/completions",
            {
                model: "gpt-4o-mini",  
                messages: [
                    { role: "system", content: "You are a medical assistant that provides prescriptions." },
                    { role: "user", content: `Based on the following symptoms, provide a medical prescription: ${text}` },
                ],
            },
            {
                headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
            }
        );

        const prescription = response.data.choices[0]?.message?.content || "No prescription generated.";
        res.json({ prescription });
    } catch (error) {
        console.error("OpenAI API error:", error?.response?.data || error);

        if (error?.response?.data?.error?.code === "insufficient_quota") {
            return res.status(403).json({ 
                error: "API quota exceeded. Please try again later or contact support." 
            });
        }

        res.status(500).json({ error: "Failed to generate prescription. Please try again later." });
    }
});

// Read Notes


// Register User
app.post('/register/user', upload.single('profilePic'), async (req, res) => {
    const { firstName, lastName, email, address, countryCode, nhsNumber, phone, bloodGroup, gender, password } = req.body;

    // Validate that gender is one of the allowed values
    const validGenders = ['Male', 'Female', 'Other'];
    if (!validGenders.includes(gender)) {
        return res.status(400).send('Invalid gender value. It must be one of: Male, Female, Other.');
    }

    // Validate that fields do not exceed the maximum allowed length
    if (firstName.length > 255 || lastName.length > 255 || email.length > 255) {
        return res.status(400).send('Some input values exceed the maximum allowed length.');
    }

    // Validate that required fields are not empty
    if (!firstName || !lastName || !email || !phone || !password) {
        return res.status(400).send('Please provide all required fields.');
    }

    // Handle profile picture (if provided)
    const profilePic = req.file ? req.file.filename : null;

    // Hash the password before storing it
    const hashedPassword = await bcrypt.hash(password, 10);

    // SQL query to insert the user data
    const sql = `
        INSERT INTO users 
        (first_name, last_name, email, address, country_code, nhs_number, phone, blood_group, gender, profile_pic, password, created_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;

    db.query(sql, [firstName, lastName, email, address, countryCode, nhsNumber, phone, bloodGroup, gender, profilePic, hashedPassword], (err, result) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('An error occurred while registering the user.');
        }

        // Get the inserted user ID
        const userId = result.insertId;

        // Send back the user details along with the profile picture filename
        res.status(200).json({
            message: 'User registered successfully!',
            user: {
                id: userId,
                firstName,
                lastName,
                email,
                address,
                countryCode,
                nhsNumber,
                phone,
                bloodGroup,
                gender,
                profilePic, // Profile picture filename
            }
        });
    });
});

// Register Doctor
app.post('/register/doctor', upload.single('profilePic'), async (req, res) => {
    const { firstName, lastName, email, address, countryCode, nhsNumber, phone, department, role, hospital, gender, password } = req.body;
    const profilePic = req.file ? req.file.filename : null;

    // Hash the password before storing it
    const hashedPassword = await bcrypt.hash(password, 10);

    const sql = 'INSERT INTO doctors (first_name, last_name, email, address, country_code, nhs_number, phone, department, role, hospital, gender, profile_pic, password) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    db.query(sql, [firstName, lastName, email, address, countryCode, nhsNumber, phone, department, role, hospital, gender, profilePic, hashedPassword], (err, result) => {
        if (err) return res.status(500).send(err);

        // Send back the doctor details along with the profile picture filename
        res.status(200).json({
            message: 'Doctor registered successfully!',
            doctor: {
              id,
                firstName,
                lastName,
                email,
                address,
                countryCode,
                nhsNumber,
                phone,
                department,
                role,
                hospital,
                gender,
                profilePic, 
            }
        });
    });
});// Assuming this is in your backend
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  // Check if email and password are provided
  if (!email || !password) {
    return res.status(400).send({ message: 'Email and password are required' });
  }

  // Check if the user exists in the 'users' table
  const sqlUser = 'SELECT * FROM users WHERE email = ?';
  db.query(sqlUser, [email], async (err, userResult) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).send({ message: 'Database error' });
    }

    if (userResult.length > 0) {
      const user = userResult[0];
      const passwordMatch = await bcrypt.compare(password, user.password);
      if (passwordMatch) {
        return res.status(200).json({ message: 'User logged in successfully', user });
      } else {
        return res.status(400).send({ message: 'Invalid email or password' });
      }
    }

    // Check if the doctor exists in the 'doctors' table
    const sqlDoctor = 'SELECT * FROM doctors WHERE email = ?';
    db.query(sqlDoctor, [email], async (err, doctorResult) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).send({ message: 'Database error' });
      }

      if (doctorResult.length > 0) {
        const doctor = doctorResult[0];
        const passwordMatch = await bcrypt.compare(password, doctor.password);
        if (passwordMatch) {
          return res.status(200).json({ message: 'Doctor logged in successfully', doctor });
        } else {
          return res.status(400).send({ message: 'Invalid email or password' });
        }
      }

      return res.status(400).send({ message: 'Invalid email or password' });
    });
  });
});
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// app.use('/api', doctorsRoutes);
app.get('/api/user/:id', (req, res) => {
  const userId = req.params.id;
  
  // Query the MySQL database to fetch user details
  const query = 'SELECT * FROM users WHERE id = ?';
  
  db.execute(query, [userId], (err, result) => {
    if (err) {
      console.error('Error fetching user data:', err);
      return res.status(500).json({ message: 'Error fetching user data' });
    }

    // Return user details as JSON response
    if (result.length > 0) {
      return res.json(result[0]);
    } else {
      return res.status(404).json({ message: 'User not found' });
    }
  });
});
// Fetch all social platforms for a user
app.get('/api/social-platforms/:userId', (req, res) => {
  const { userId } = req.params;
  db.query(
    'SELECT * FROM social_platforms WHERE user_id = ?',
    [userId],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(results);
    }
  );
});

// Add a new social platform
app.post('/api/social-platforms', (req, res) => {
  const { user_id, platform, url } = req.body;
  db.query(
    'INSERT INTO social_platforms (user_id, platform, url) VALUES (?, ?, ?)',
    [user_id, platform, url],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: results.insertId, user_id, platform, url });
    }
  );
});

// Update a social platform
app.put('/api/social-platforms/:id', (req, res) => {
  const { id } = req.params;
  const { platform, url } = req.body;
  db.query(
    'UPDATE social_platforms SET platform = ?, url = ? WHERE id = ?',
    [platform, url, id],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Social platform updated successfully' });
    }
  );
});

// Delete a social platform
app.delete('/api/social-platforms/:id', (req, res) => {
  const { id } = req.params;
  db.query('DELETE FROM social_platforms WHERE id = ?', [id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Social platform deleted successfully' });
  });
});
// Fetch all medical complications for a user
app.get('/api/medical-complications/:userId', (req, res) => {
  const { userId } = req.params;
  db.query(
    'SELECT * FROM medical_complications WHERE user_id = ?',
    [userId],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(results);
    }
  );
});

// Add a new medical complication
app.post('/api/medical-complications', (req, res) => {
  const { user_id, complication, diagnosed_at } = req.body;
  db.query(
    'INSERT INTO medical_complications (user_id, complication, diagnosed_at) VALUES (?, ?, ?)',
    [user_id, complication, diagnosed_at],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: results.insertId, user_id, complication, diagnosed_at });
    }
  );
});

// Update a medical complication
app.put('/api/medical-complications/:id', (req, res) => {
  const { id } = req.params;
  const { complication, diagnosed_at } = req.body;
  db.query(
    'UPDATE medical_complications SET complication = ?, diagnosed_at = ? WHERE id = ?',
    [complication, diagnosed_at, id],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Medical complication updated successfully' });
    }
  );
});

// Delete a medical complication
app.delete('/api/medical-complications/:id', (req, res) => {
  const { id } = req.params;
  db.query('DELETE FROM medical_complications WHERE id = ?', [id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Medical complication deleted successfully' });
  });
});
// Fetch all organizations for a user
app.get('/api/organizations/:userId', (req, res) => {
  const { userId } = req.params;
  db.query(
    'SELECT * FROM organizations WHERE user_id = ?',
    [userId],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(results);
    }
  );
});

// Add a new organization
app.post('/api/organizations', (req, res) => {
  const { user_id, organization_name, role, joined_at } = req.body;
  db.query(
    'INSERT INTO organizations (user_id, organization_name, role, joined_at) VALUES (?, ?, ?, ?)',
    [user_id, organization_name, role, joined_at],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: results.insertId, user_id, organization_name, role, joined_at });
    }
  );
});

// Update an organization
app.put('/api/organizations/:id', (req, res) => {
  const { id } = req.params;
  const { organization_name, role, joined_at } = req.body;
  db.query(
    'UPDATE organizations SET organization_name = ?, role = ?, joined_at = ? WHERE id = ?',
    [organization_name, role, joined_at, id],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Organization updated successfully' });
    }
  );
});

// Delete an organization
app.delete('/api/organizations/:id', (req, res) => {
  const { id } = req.params;
  db.query('DELETE FROM organizations WHERE id = ?', [id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Organization deleted successfully' });
  });
});

// Route to fetch all doctors
app.get("/doctors", (req, res) => {
  // Use the existing db connection for the query
  const query = `
    SELECT id, first_name, last_name, department AS specialty, hospital, role, gender, profile_pic
    FROM doctors;
  `;

  db.query(query, (error, results) => {
    if (error) {
      console.error("Error fetching doctors:", error);
      return res.status(500).json({ error: "Failed to fetch doctors" });
    }

    // Return the data
    res.status(200).json(results);
  });
});

// Route to fetch distinct departments
app.get("/departments", (req, res) => {
  // Use the existing db connection for the query
  const query = `
    SELECT DISTINCT department FROM doctors;
  `;

  db.query(query, (error, results) => {
    if (error) {
      console.error("Error fetching departments:", error);
      return res.status(500).json({ error: "Failed to fetch departments" });
    }

    // Return the unique departments
    res.status(200).json(results);
  });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
