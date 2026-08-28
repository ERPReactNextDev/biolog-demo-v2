import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { data: tables, error: tablesError } = await supabase.rpc('get_tables'); // Custom RPC or just list some known tables
    
    // Check if gps_reports exists and count documents
    const { count: gpsCount, data: gpsSample, error: gpsError } = await supabase
      .from("gps_reports")
      .select("*", { count: "exact" })
      .limit(2); //comment sample
    
    return res.status(200).json({
      database: "Supabase",
      gpsReports: {
        exists: !gpsError,
        count: gpsCount || 0,
        sample: gpsSample,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString(),
    });
  }
}
