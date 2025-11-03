// Automatic scheduler for daily tender refresh
const cron = require("node-cron");
const { exec } = require("child_process");

console.log("📅 Tender Scheduler Started");
console.log("⏰ Will fetch new tenders daily at 5:00 AM\n");

// Schedule tender fetch every day at 2:00 AM
cron.schedule("0 5 * * *", () => {
  console.log("🔄 Running scheduled tender refresh...");
  console.log(`📅 ${new Date().toLocaleString()}\n`);

  exec("node fetch-and-save-tenders.js", (error, stdout, stderr) => {
    if (error) {
      console.error(`❌ Error: ${error.message}`);
      return;
    }
    if (stderr) {
      console.error(`⚠️  Warning: ${stderr}`);
      return;
    }
    console.log(stdout);
    console.log("✅ Scheduled refresh complete\n");
  });
});

// // Also run immediately on startup (optional)
// console.log("🚀 Running initial tender fetch...\n");
// exec("node fetch-and-save-tenders.js", (error, stdout, stderr) => {
//   if (error) {
//     console.error(`❌ Error: ${error.message}`);
//     return;
//   }
//   console.log(stdout);
//   console.log("✅ Initial fetch complete\n");
// });

// // Keep the scheduler running
// console.log("✨ Scheduler is running. Press Ctrl+C to stop.\n");
