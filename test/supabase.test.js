require("dotenv").config();
const supabase = require("../services/supabase.services");

async function testConnection() {
  console.log("Testing Supabase connection...\n");

  try {
    // Test 1: Check if we can connect
    const { data, error } = await supabase
      .from("analyses")
      .select("count")
      .limit(1);

    if (error) {
      console.error("Connection failed:", error.message);
      process.exit(1);
    }

    console.log("✅ Supabase connection successful!");
    console.log('✅ Table "analyses" is accessible');
  } catch (error) {
    console.error("❌ Connection error:", error.message);
    process.exit(1);
  }
}

testConnection();
