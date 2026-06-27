const fs = require('fs');
const { execSync } = require('child_process');

try {
  console.log('--- Probing file ---');
  const stats = fs.statSync('/downloads/1782383080984.mp4');
  console.log('Size:', stats.size);
  
  // Read first 100 bytes of file to check if it is HTML or MP4
  const fd = fs.openSync('/downloads/1782383080984.mp4', 'r');
  const buffer = Buffer.alloc(100);
  fs.readSync(fd, buffer, 0, 100, 0);
  fs.closeSync(fd);
  
  console.log('First 100 bytes as string:', buffer.toString('utf8'));
  console.log('First 100 bytes as hex:', buffer.toString('hex'));
  
  try {
    const ffprobeOutput = execSync('ffprobe -v error -show_format -show_streams /downloads/1782383080984.mp4', { encoding: 'utf8' });
    console.log('FFprobe output:', ffprobeOutput);
  } catch (err) {
    console.log('FFprobe error:', err.message);
  }
} catch (e) {
  console.log('Error:', e.message);
}
