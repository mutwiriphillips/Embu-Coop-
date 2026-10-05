"use client";

import { useEffect, useState } from "react";

// Files are protected: GET /api/files/:id needs the same sign-in as the record
// they belong to. A plain <a href> or <img src> can't send that, so files are
// fetched with the right API client (staff/cooperative `api`, or `agrovetApi`)
// and shown from a temporary in-browser copy.

export async function openFile(client, fileId, { download = false, fileName } = {}) {
  const res = await client.get(`/files/${fileId}`, { responseType: "blob" });
  const url = URL.createObjectURL(res.data);
  if (download) {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName || "file";
    a.click();
  } else {
    window.open(url, "_blank", "noopener");
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// <AuthedImage client={api} fileId={id} /> shows a protected photo.
export function AuthedImage({ client, fileId, alt = "", className = "" }) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let url = "";
    let cancelled = false;
    client.get(`/files/${fileId}`, { responseType: "blob" })
      .then((res) => { if (!cancelled) { url = URL.createObjectURL(res.data); setSrc(url); } })
      .catch(() => !cancelled && setFailed(true));
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [client, fileId]);
  if (failed) return <div className={`flex items-center justify-center bg-gray-100 text-xs text-gray-400 ${className}`}>Unavailable</div>;
  if (!src) return <div className={`animate-pulse bg-gray-100 ${className}`} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={`object-cover ${className}`} />;
}

export const formatBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// What each upload accepts, mirrored from the server's rules so people find out
// before uploading. The server still checks every file's actual content.
export const ACCEPT = {
  document: "application/pdf,image/jpeg,image/png,image/webp",
  photo: "image/jpeg,image/png,image/webp",
};
export const HINT = {
  document: "PDF, or a clear photo of the paper (JPG, PNG, WEBP), up to 10 MB",
  photo: "JPG, PNG or WEBP, up to 5 MB",
};

// List the files attached to a record (metadata only).
export function useFileList(client, query, deps = []) {
  const [files, setFiles] = useState([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!query) return;
    client.get("/files", { params: query }).then((res) => setFiles(res.data)).catch(() => setFiles([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);
  return { files, reload: () => setTick((t) => t + 1) };
}
