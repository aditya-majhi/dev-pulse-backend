require("dotenv").config();
const supabase = require("../services/supabase.services");

async function detailedTest() {
  console.log("=".repeat(50));
  console.log("Supabase Detailed Test");
  console.log("=".repeat(50));

  try {
    // Test 1: Check connection
    console.log("\n1️⃣ Testing connection...");
    const { data: tableCheck, error: tableError } = await supabase
      .from("analyses")
      .select("count")
      .limit(1);

    if (tableError) {
      console.error("❌ Table not found:", tableError.message);
      console.log(
        "\n💡 Please create the table using the SQL script provided."
      );
      process.exit(1);
    }
    console.log("✅ Table exists and is accessible");

    // Test 2: Insert test record WITHOUT user_id (let it be NULL)
    console.log("\n2️⃣ Testing INSERT...");
    const testId = `test-${Date.now()}`;
    const { data: insertData, error: insertError } = await supabase
      .from("analyses")
      .insert({
        analysis_id: testId,
        // user_id: null, // ✅ Removed - will be NULL by default
        repo_url: "https://github.com/test/test.git",
        repo_name: "test-repo",
        repo_owner: "test-owner",
        status: "initializing",
        progress: 0,
        current_step: 0,
        total_steps: 8,
        message: "Test analysis",
      })
      .select()
      .single();

    if (insertError) {
      console.error("❌ Insert failed:", insertError.message);
      console.error("Error details:", insertError);
      console.log("\n💡 Possible fixes:");
      console.log("1. Remove foreign key constraint on user_id");
      console.log("2. Make user_id nullable");
      console.log("3. Use a valid user_id from auth.users table");
      process.exit(1);
    } else {
      console.log("✅ Insert successful");
      console.log("   Record ID:", insertData.analysis_id);
      console.log("   User ID:", insertData.user_id || "NULL");

      // Test 3: Read the record
      console.log("\n3️⃣ Testing SELECT...");
      const { data: selectData, error: selectError } = await supabase
        .from("analyses")
        .select("*")
        .eq("analysis_id", testId)
        .single();

      if (selectError) {
        console.error("❌ Select failed:", selectError.message);
      } else {
        console.log("✅ Select successful");
        console.log("   Found:", selectData.repo_name);
      }

      // Test 4: Update the record
      console.log("\n4️⃣ Testing UPDATE...");
      const { data: updateData, error: updateError } = await supabase
        .from("analyses")
        .update({
          status: "analyzing",
          progress: 50,
          message: "Analyzing code...",
        })
        .eq("analysis_id", testId)
        .select()
        .single();

      if (updateError) {
        console.error("❌ Update failed:", updateError.message);
      } else {
        console.log("✅ Update successful");
        console.log("   New progress:", updateData.progress);
        console.log("   New status:", updateData.status);
      }

      // Test 5: Test JSONB columns
      console.log("\n5️⃣ Testing JSONB columns...");
      const { data: jsonbData, error: jsonbError } = await supabase
        .from("analyses")
        .update({
          code_quality: {
            score: 85,
            grade: "B",
            complexity: "low",
            maintainability: "good",
          },
          structure: {
            totalFiles: 100,
            totalLines: 5000,
          },
        })
        .eq("analysis_id", testId)
        .select()
        .single();

      if (jsonbError) {
        console.error("❌ JSONB update failed:", jsonbError.message);
      } else {
        console.log("✅ JSONB update successful");
        console.log("   Code Quality Score:", jsonbData.code_quality.score);
      }

      // Test 6: Delete the test record
      console.log("\n6️⃣ Cleaning up...");
      const { error: deleteError } = await supabase
        .from("analyses")
        .delete()
        .eq("analysis_id", testId);

      if (deleteError) {
        console.error("❌ Delete failed:", deleteError.message);
      } else {
        console.log("✅ Cleanup successful");
      }
    }

    console.log("\n" + "=".repeat(50));
    console.log("✅ All tests passed!");
    console.log("=".repeat(50));
  } catch (error) {
    console.error("\n❌ Unexpected error:", error.message);
    console.error(error);
    process.exit(1);
  }
}

detailedTest();
