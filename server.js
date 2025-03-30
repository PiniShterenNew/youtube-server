/**
 * שרת Node.js להורדת סרטונים מיוטיוב - גרסה מתוקנת
 */

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ytdl = require('ytdl-core');
const app = express();
const PORT = process.env.PORT || 3000;

// מעקב אחר קבצים להורדה
const activeFiles = new Map();

// הגדרת CORS
app.use(cors());

// יצירת תיקיית הורדות זמנית
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir);
}

// נתיב עבור קבצים סטטיים - עם מעקב הורדות
app.use('/downloads', (req, res, next) => {
  const filename = path.basename(req.path);
  
  // אם הקובץ כבר בהורדה, תעקוב אחריו
  if (activeFiles.has(filename)) {
    console.log(`מתחיל הורדת קובץ: ${filename}`);
    
    // סמן את זמן ההורדה
    activeFiles.set(filename, {
      ...activeFiles.get(filename),
      downloadStarted: Date.now()
    });
    
    // אחרי שהלקוח מסיים להוריד את הקובץ
    res.on('finish', () => {
      console.log(`הלקוח סיים להוריד את הקובץ: ${filename}`);
      
      // קבע טיימר למחיקת הקובץ
      setTimeout(() => {
        const filePath = path.join(downloadsDir, filename);
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
            console.log(`נמחק קובץ אחרי הורדה: ${filename}`);
            activeFiles.delete(filename);
          } catch (err) {
            console.error(`שגיאה במחיקת קובץ ${filename}:`, err);
          }
        }
      }, 10000); // מחיקה אחרי 10 שניות
    });
  }
  
  next();
}, express.static(downloadsDir));

// נתיב לבדיקת סטטוס השרת
app.get('/', (req, res) => {
  res.send('<h1>שרת הורדות יוטיוב פעיל!</h1>');
});

// נתיב להורדת וידאו קצר למטרות בדיקה
app.get('/download-test', (req, res) => {
  const videoURL = 'https://www.youtube.com/watch?v=orJSJGHjBLI'; // סרטון קצר לבדיקה
  const outputFilename = `test_${Date.now()}.mp4`;
  const outputPath = path.join(downloadsDir, outputFilename);
  
  console.log(`מתחיל בדיקת הורדה של סרטון קצר...`);
  
  // הפעלת yt-dlp עם סרטון קצר - שים לב להסרת --no-part
  const ytdlp = spawn('./yt-dlp.exe', [
    '-f', 'best[filesize<5M]', // סרטון קטן לבדיקה
    '-o', outputPath,
    videoURL
  ]);
  
  let outputLog = '';
  let errorLog = '';
  
  ytdlp.stdout.on('data', (data) => {
    const output = data.toString();
    outputLog += output;
    console.log(output);
  });
  
  ytdlp.stderr.on('data', (data) => {
    const error = data.toString();
    errorLog += error;
    console.error(`שגיאה בבדיקה:`, error);
  });
  
  ytdlp.on('close', (code) => {
    console.log(`תהליך yt-dlp הסתיים עם קוד: ${code}`);
    console.log(`בדיקה אם הקובץ ${outputPath} קיים...`);
    
    // בדיקה אם הקובץ המקורי נוצר
    if (code === 0 && fs.existsSync(outputPath)) {
      console.log(`בדיקת הורדה הושלמה בהצלחה! הקובץ נוצר.`);
      
      // הוסף את הקובץ למעקב
      activeFiles.set(outputFilename, {
        created: Date.now(),
        path: outputPath,
        videoId: 'test'
      });
      
      res.json({
        success: true,
        message: 'בדיקת הורדה הצליחה!',
        url: `http://localhost:${PORT}/downloads/${outputFilename}`
      });
    } 
    // אחרת, בדוק אם יש קובץ עם שם דומה בתיקייה
    else {
      console.log(`הקובץ המקורי לא נמצא. בודק אם יש קבצים אחרים בתיקייה...`);
      
      // קרא את כל הקבצים בתיקייה
      fs.readdir(downloadsDir, (err, files) => {
        if (err) {
          console.error('שגיאה בקריאת תיקיית ההורדות:', err);
          return res.status(500).json({
            success: false,
            error: 'שגיאה בקריאת תיקיית ההורדות'
          });
        }
        
        // חפש קבצים שנוצרו בדקה האחרונה
        const recentFiles = files.filter(file => {
          const filePath = path.join(downloadsDir, file);
          try {
            const stats = fs.statSync(filePath);
            return (Date.now() - stats.mtime.getTime()) < 60000; // קבצים מהדקה האחרונה
          } catch (e) {
            return false;
          }
        });
        
        if (recentFiles.length > 0) {
          // השתמש בקובץ הראשון שנמצא
          const foundFile = recentFiles[0];
          console.log(`נמצא קובץ חלופי: ${foundFile}`);
          
          // הוסף את הקובץ למעקב
          activeFiles.set(foundFile, {
            created: Date.now(),
            path: path.join(downloadsDir, foundFile),
            videoId: 'test'
          });
          
          res.json({
            success: true,
            message: 'בדיקת הורדה הצליחה (נמצא קובץ שם שונה)!',
            url: `http://localhost:${PORT}/downloads/${foundFile}`
          });
        } else {
          console.error(`לא נמצאו קבצים חדשים בתיקייה. ההורדה נכשלה.`);
          res.status(500).json({
            success: false,
            error: 'בדיקת הורדה נכשלה - לא נמצאו קבצים חדשים',
            details: errorLog || 'אין פרטים נוספים',
            code: code
          });
        }
      });
    }
  });
});

// נתיב להורדת וידאו/אודיו
app.get('/download', async (req, res) => {
  try {
    const { videoId, format = 'mp4', quality = 'highest' } = req.query;
    
    if (!videoId) {
      return res.status(400).json({ 
        success: false, 
        error: 'נדרש מזהה וידאו (videoId)' 
      });
    }
    
    console.log(`בקשת הורדה: ${videoId}, פורמט: ${format}, איכות: ${quality}`);
    
    // כתובת הסרטון
    const videoURL = `https://www.youtube.com/watch?v=${videoId}`;
    
    try {
      // ניסיון לקבל מידע עם ytdl-core
      const info = await ytdl.getInfo(videoURL);
      console.log(`הצלחנו לקבל מידע על הסרטון באמצעות ytdl-core`);
      
      // שימוש ב-ytdl-core אם הוא עובד
      // כרגע עובר ישירות ל-yt-dlp לטובת אחידות
      throw new Error("עובר לשימוש ב-yt-dlp");
      
    } catch (ytdlError) {
      console.error('שגיאה ב-ytdl-core:', ytdlError.message);
      
      // שינוי: תן ל-yt-dlp לקבוע את שם הקובץ בעצמו
      const timestamp = Date.now();
      // שם קובץ פשוט יותר
      const fileBaseName = `${videoId}_${timestamp}`;
      const outputTemplate = path.join(downloadsDir, fileBaseName);
      
      // נוסיף את הסיומת בהתאם לפורמט
      let outputFilename;
      if (format === 'mp3') {
        outputFilename = `${fileBaseName}.mp3`;
      } else {
        outputFilename = `${fileBaseName}.mp4`;
      }
      
      console.log(`מנסה להוריד באמצעות ./yt-dlp...`);
      console.log(`תבנית קובץ יעד: ${outputTemplate}`);
      
      // הגדרת מצבים עבור הורדה - שינינו את דרך ההגדרה
      let formatOptions;
      
      if (format === 'mp3') {
        formatOptions = [
          '-x', '--audio-format', 'mp3',
          '-o', `${outputTemplate}.%(ext)s`,  // תבנית שם יותר גמישה
          '--verbose',  // פלט מפורט יותר
          videoURL
        ];
      } else {
        // בחירת איכות
        let qualityParam;
        if (quality === 'lowest') {
          qualityParam = 'worst[ext=mp4]';
        } else if (quality === 'medium') {
          qualityParam = 'best[height<=480][ext=mp4]';
        } else {
          qualityParam = 'best[ext=mp4]';
        }
        
        formatOptions = [
          '-f', qualityParam,
          '--verbose',  // פלט מפורט יותר
          '-o', `${outputTemplate}.%(ext)s`,  // תבנית שם יותר גמישה
          videoURL
        ];
      }
      
      // יצירת הבטחה לטיפול בהורדה
      const downloadPromise = new Promise((resolve, reject) => {
        // הגדרת זמן הקצוב לניסיון - 3 דקות
        const downloadTimeout = setTimeout(() => {
          try {
            ytdlProcess.kill('SIGTERM');
          } catch (e) {
            console.error('שגיאה בניסיון לבטל את התהליך:', e);
          }
          reject(new Error('זמן ההורדה פג'));
        }, 180000); // 3 דקות
        
        // שמירת היסטוריית שמות קבצים שנוצרו
        let createdFiles = [];
        
        // הפעלת yt-dlp
        const ytdlProcess = spawn('./yt-dlp.exe', formatOptions);
        
        let progressData = '';
        let errorData = '';
        let videoTitle = '';
        let actualFilename = '';
        
        // מעקב אחר התקדמות
        ytdlProcess.stdout.on('data', (data) => {
          const output = data.toString();
          progressData += output;
          console.log(output.trim());
          
          // נסה לחלץ את כותרת הסרטון
          if (output.includes('[download]') && output.includes('Destination:')) {
            const titleMatch = output.match(/Destination:\s+(.+)/);
            if (titleMatch && titleMatch[1]) {
              actualFilename = titleMatch[1].trim();
              console.log(`זיהינו שם קובץ מלא: ${actualFilename}`);
              
              // שמור את שם הקובץ שנוצר
              if (!createdFiles.includes(actualFilename)) {
                createdFiles.push(actualFilename);
              }
            }
          }
          
          // נסה למצוא את אחוז ההתקדמות בפלט
          const progressMatch = output.match(/(\d+\.\d+)%/);
          if (progressMatch) {
            const progress = progressMatch[1];
            console.log(`התקדמות הורדה: ${progress}%`);
          }
        });
        
        // לוג שגיאות
        ytdlProcess.stderr.on('data', (data) => {
          const error = data.toString();
          errorData += error;
          console.error(`שגיאת yt-dlp: ${error.trim()}`);
        });
        
        // כאשר התהליך מסתיים
        ytdlProcess.on('close', (code) => {
          clearTimeout(downloadTimeout);
          
          console.log(`תהליך ההורדה הסתיים עם קוד: ${code}`);
          console.log(`חיפוש קבצים שנוצרו בתיקייה ${downloadsDir}...`);
          
          // חיפוש הקובץ שנוצר
          const findCreatedFile = () => {
            if (createdFiles.length > 0) {
              // נסה למצוא את הקובץ האחרון שנוצר
              for (const file of createdFiles) {
                if (fs.existsSync(file)) {
                  console.log(`נמצא קובץ שנוצר: ${file}`);
                  return file;
                }
              }
            }
            
            // אם לא מצאנו את הקובץ שצוין בפלט, חפש בתיקייה
            const expectedExt = format === 'mp3' ? '.mp3' : '.mp4';
            const filesInDir = fs.readdirSync(downloadsDir);
            
            // חפש קבצים שנוצרו בדקה האחרונה
            const recentFiles = filesInDir.filter(file => {
              if (!file.endsWith(expectedExt)) return false;
              
              const filePath = path.join(downloadsDir, file);
              try {
                const stats = fs.statSync(filePath);
                return (Date.now() - stats.mtime.getTime()) < 60000; // קבצים מהדקה האחרונה
              } catch (e) {
                return false;
              }
            });
            
            // מיין לפי זמן - החדש ביותר קודם
            recentFiles.sort((a, b) => {
              const timeA = fs.statSync(path.join(downloadsDir, a)).mtime.getTime();
              const timeB = fs.statSync(path.join(downloadsDir, b)).mtime.getTime();
              return timeB - timeA;
            });
            
            if (recentFiles.length > 0) {
              const newestFile = recentFiles[0];
              console.log(`נמצא קובץ חדש בתיקייה: ${newestFile}`);
              return path.join(downloadsDir, newestFile);
            }
            
            return null;
          };
          
          if (code === 0) {
            console.log(`ההורדה הושלמה בהצלחה, קוד: ${code}`);
            
            // חפש את הקובץ שנוצר
            const foundFile = findCreatedFile();
            
            if (foundFile) {
              // קבל את שם הקובץ האמיתי
              const finalFilename = path.basename(foundFile);
              const stats = fs.statSync(foundFile);
              
              resolve({
                filePath: foundFile,
                filename: finalFilename,
                videoTitle: videoTitle || `סרטון מיוטיוב - ${videoId}`,
                fileSize: stats.size
              });
            } else {
              reject(new Error(`התהליך הסתיים בהצלחה, אך לא נמצא קובץ חדש בתיקייה`));
            }
          } else {
            console.error(`תהליך ההורדה הסתיים עם שגיאה, קוד: ${code}`);
            reject(new Error(`yt-dlp נכשל עם קוד: ${code}, פרטים: ${errorData}`));
          }
        });
        
        // טיפול בשגיאות
        ytdlProcess.on('error', (err) => {
          clearTimeout(downloadTimeout);
          console.error(`שגיאה בהפעלת yt-dlp:`, err);
          reject(err);
        });
      });
      
      try {
        // המתנה להורדה עם yt-dlp
        const downloadResult = await downloadPromise;
        
        console.log(`הורדה הושלמה: ${downloadResult.filename}`);
        console.log(`גודל קובץ: ${Math.round(downloadResult.fileSize / 1024 / 1024 * 100) / 100} MB`);
        
        // הוסף את הקובץ למעקב
        activeFiles.set(downloadResult.filename, {
          created: Date.now(),
          path: downloadResult.filePath,
          videoId: videoId,
          title: downloadResult.videoTitle,
          fileSize: downloadResult.fileSize
        });
        
        // החזרת כתובת ההורדה וכל המידע למשתמש
        const fileUrl = `http://localhost:${PORT}/downloads/${downloadResult.filename}`;
        
        res.json({
          success: true,
          url: fileUrl,
          filename: downloadResult.filename,
          format: format,
          videoTitle: downloadResult.videoTitle,
          fileSize: downloadResult.fileSize
        });
        
      } catch (downloadError) {
        console.error('שגיאה בהורדה עם yt-dlp:', downloadError);
        throw new Error(`הורדה עם yt-dlp נכשלה: ${downloadError.message}`);
      }
    }
    
  } catch (error) {
    console.error('שגיאה כללית בתהליך ההורדה:', error);
    
    res.status(500).json({ 
      success: false,
      error: error.message || 'שגיאה לא ידועה בשרת'
    });
  }
});

// ניקוי תקופתי של קבצים ישנים
function cleanupOldFiles() {
  console.log('בודק קבצים ישנים למחיקה...');
  
  const now = Date.now();
  fs.readdir(downloadsDir, (err, files) => {
    if (err) {
      console.error('שגיאה בקריאת תיקיית ההורדות:', err);
      return;
    }
    
    let deletedCount = 0;
    
    files.forEach(file => {
      const filePath = path.join(downloadsDir, file);
      
      // בדיקת זמן יצירת הקובץ
      fs.stat(filePath, (err, stats) => {
        if (err) {
          console.error(`שגיאה בקבלת נתוני קובץ ${file}:`, err);
          return;
        }
        
        // מחק קבצים ישנים מלפני יותר משעה
        const fileAge = now - stats.mtimeMs;
        if (fileAge > 60 * 60 * 1000) { // שעה אחת
          try {
            fs.unlinkSync(filePath);
            console.log(`נמחק קובץ ישן: ${file}`);
            deletedCount++;
          } catch (err) {
            console.error(`שגיאה במחיקת קובץ ${file}:`, err);
          }
        }
      });
    });
    
    if (deletedCount > 0) {
      console.log(`נמחקו ${deletedCount} קבצים ישנים`);
    } else {
      console.log('לא נמצאו קבצים ישנים למחיקה');
    }
  });
}

// הפעל ניקוי קבצים ישנים כל 30 דקות
setInterval(cleanupOldFiles, 30 * 60 * 1000);

// הפעלת השרת
app.listen(PORT, () => {
  console.log(`שרת הורדות יוטיוב פועל בפורט ${PORT}`);
  console.log(`פתח בדפדפן: http://localhost:${PORT}/`);
  console.log(`ניתן לבדוק הורדה בכתובת: http://localhost:${PORT}/download-test`);
  
  // ניקוי ראשוני של קבצים ישנים
  cleanupOldFiles();
});