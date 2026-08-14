import React, { useCallback, useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import FormModal from '@/components/FormModal';
import {
  Save,
  RotateCcw,
  Upload,
  ShieldAlert,
  Trash2,
  Download,
  Lock,
  FileUp,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import {
  APP_ENVIRONMENT,
  IS_PRODUCTION,
  RESET_CONFIRM_PHRASE,
  RESTORE_CONFIRM_PHRASE,
  MAX_RESTORE_FILE_SIZE,
} from '@/lib/dbEnv';

// Fetch a signed URL as a blob and force a browser download (never renders inline).
async function triggerDownload(signedUrl, fileName) {
  const res = await fetch(signedUrl);
  if (!res.ok) throw new Error(`Gagal mengunduh file (status ${res.status})`);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  a.href = url;
  a.download = fileName || 'LABPRO_BACKUP.json';

  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const makeBackupDownloadName = (name, fallback = 'LABPRO_BACKUP') => {
  const safeName = String(name || fallback)
    .trim()
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_');

  return `${safeName || fallback}.json`;
};

const ACTIVE_RESTORE_STORAGE_KEY = 'labpro_active_restore_session';
const MAX_NETWORK_RETRIES = 5;
const NETWORK_RETRY_DELAYS = [1000, 2000, 4000, 8000, 12000];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isTransientNetworkError = (error) => {
  if (error?.restoreData) return false;

  const status = Number(error?.response?.status || 0);
  const message = String(
    error?.response?.data?.error || error?.message || error || ''
  ).toLowerCase();

  return (
    [408, 429, 502, 503, 504].includes(status) ||
    error?.code === 'ERR_NETWORK' ||
    error?.code === 'ECONNABORTED' ||
    message.includes('network error') ||
    message.includes('failed to fetch') ||
    message.includes('load failed') ||
    message.includes('timeout') ||
    message.includes('cloudflare') ||
    message.includes('invalid or incomplete response')
  );
};

function readStoredRestoreSession() {
  try {
    return JSON.parse(
      localStorage.getItem(ACTIVE_RESTORE_STORAGE_KEY) || 'null'
    );
  } catch {
    localStorage.removeItem(ACTIVE_RESTORE_STORAGE_KEY);
    return null;
  }
}

export default function DatabaseManagement() {
  const { toast } = useToast();

  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Save modal
  const [saveOpen, setSaveOpen] = useState(false);
  const [bkName, setBkName] = useState('');
  const [bkNotes, setBkNotes] = useState('');
  const [bkType, setBkType] = useState('operational');
  const [bkEncrypt, setBkEncrypt] = useState(false);
  const [bkPassword, setBkPassword] = useState('');
  const [lastBackup, setLastBackup] = useState(null);

  // Reset modal
  const [resetOpen, setResetOpen] = useState(false);
  const [resetMode, setResetMode] = useState('transaction');
  const [resetSequences, setResetSequences] = useState(true);
  const [skipBackup, setSkipBackup] = useState(false);
  const [resetPhrase, setResetPhrase] = useState('');
  const [resetAck, setResetAck] = useState(false);
  const [resetPassword, setResetPassword] = useState('');

  // Stored-backup restore modal
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreId, setRestoreId] = useState('');
  const [restoreMode, setRestoreMode] = useState('operational');
  const [restorePhrase, setRestorePhrase] = useState('');
  const [restoreAck, setRestoreAck] = useState(false);

  // File restore modal
  const [fileOpen, setFileOpen] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [validateError, setValidateError] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [filePassword, setFilePassword] = useState('');
  const [fileMode, setFileMode] = useState('operational');
  const [filePhrase, setFilePhrase] = useState('');
  const [fileAck, setFileAck] = useState(false);
  const fileInputRef = useRef(null);

  // Batch restore progress
  const [restoreProgress, setRestoreProgress] = useState(null);
  const [restoreRunning, setRestoreRunning] = useState(false);
  const [resumableSession, setResumableSession] = useState(null);
  const [resumeChecking, setResumeChecking] = useState(false);

  const downloadAllowed = true;

  const loadBackups = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await base44.entities.DatabaseBackup.list('-created_at', 200);
      setBackups(rows || []);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Gagal memuat backup',
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadBackups();
  }, [loadBackups]);

  const clearActiveRestoreSession = useCallback(() => {
    localStorage.removeItem(ACTIVE_RESTORE_STORAGE_KEY);
    setResumableSession(null);
  }, []);

  const findResumableSession = useCallback(async () => {
    if (restoreRunning) return;

    setResumeChecking(true);
    try {
      const stored = readStoredRestoreSession();
      const rows = await base44.entities.DatabaseRestoreSession.list(
        '-created_date',
        20
      );

      const activeRows = (rows || []).filter((row) =>
        ['READY', 'RUNNING', 'PAUSED', 'VERIFYING'].includes(row.status)
      );

      // Resume only the session explicitly owned by this browser.
      // Falling back to activeRows[0] can resurrect a stale or unrelated
      // server-side session after the completed session was cleared locally.
      const active = stored?.id
        ? activeRows.find((row) => row.id === stored.id) || null
        : null;

      setResumableSession(active);

      if (active) {
        localStorage.setItem(
          ACTIVE_RESTORE_STORAGE_KEY,
          JSON.stringify({
            id: active.id,
            sessionCode: active.session_code || '',
            backupCode: active.backup_code || '',
            fileName: active.file_name || '',
            totalRecords: Number(active.total_records || 0),
          })
        );
      } else {
        localStorage.removeItem(ACTIVE_RESTORE_STORAGE_KEY);
      }
    } catch (error) {
      console.warn('[RESTORE SESSION LOOKUP FAILED]', error);
    } finally {
      setResumeChecking(false);
    }
  }, [restoreRunning]);

  useEffect(() => {
    if (fileOpen && !restoreRunning) {
      findResumableSession();
    }
  }, [fileOpen, restoreRunning, findResumableSession]);

  const fmtSize = (bytes) => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(2)} MB`;
  };

  const fmtDate = (date) =>
    date ? new Date(date).toLocaleString('id-ID') : '-';

  const statusColor = {
    COMPLETED: 'bg-emerald-100 text-emerald-700',
    CREATING: 'bg-amber-100 text-amber-700',
    FAILED: 'bg-red-100 text-red-700',
    DELETED: 'bg-slate-100 text-slate-500',
  };

  const completedBackups = backups.filter(
    (backup) => backup.status === 'COMPLETED'
  );

  const backupTypeLabel = (type) =>
    type === 'data_only'
      ? 'Data Only'
      : type === 'full'
        ? 'Full'
        : 'Operational';

  const doSave = async () => {
    if (bkEncrypt && !bkPassword) {
      toast({
        variant: 'destructive',
        title: 'Masukkan password enkripsi',
      });
      return;
    }

    setBusy(true);

    try {
      const res = await base44.functions.invoke('databaseBackup', {
        name: bkName,
        notes: bkNotes,
        backup_type: bkType,
        encrypt: bkEncrypt,
        password: bkEncrypt ? bkPassword : undefined,
      });

      const backup = res.data?.backup;

      toast({
        title: 'Backup berhasil dibuat',
        description: backup?.backup_code,
      });

      setLastBackup({
        code: backup?.backup_code,
        fileName: backup?.file_name,
        size: backup?.file_size,
      });

      try {
        const dl = await base44.functions.invoke('databaseDownloadBackup', {
          backup_id: backup.id,
        });

        const downloadFileName =
          makeBackupDownloadName(
            bkName,
            backup?.backup_code || 'LABPRO_BACKUP'
          );

        await triggerDownload(
          dl.data.signed_url,
          downloadFileName
        );

        toast({
          title: 'File terunduh',
          description: downloadFileName,
        });
      } catch (error) {
        toast({
          variant: 'destructive',
          title: 'Gagal mengunduh',
          description: error.response?.data?.error || error.message,
        });
      }

      loadBackups();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Backup gagal',
        description: error.response?.data?.error || error.message,
      });
    } finally {
      setBusy(false);
    }
  };

  const downloadBackup = async (backup) => {
    setBusy(true);

    try {
      const dl = await base44.functions.invoke('databaseDownloadBackup', {
        backup_id: backup.id,
      });

      await triggerDownload(dl.data.signed_url, dl.data.file_name);

      toast({
        title: 'File terunduh',
        description: dl.data.file_name,
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Gagal mengunduh',
        description: error.response?.data?.error || error.message,
      });
    } finally {
      setBusy(false);
    }
  };

  const reDownloadLast = async () => {
    if (!lastBackup) return;

    const rec = backups.find(
      (backup) => backup.backup_code === lastBackup.code
    );

    if (rec) {
      await downloadBackup(rec);
    }
  };

  const doReset = async () => {
    if (resetPhrase !== RESET_CONFIRM_PHRASE) {
      toast({
        variant: 'destructive',
        title: 'Kalimat konfirmasi belum sesuai',
      });
      return;
    }

    if (!resetAck) {
      toast({
        variant: 'destructive',
        title: 'Centang pemahaman risiko',
      });
      return;
    }

    if (!resetPassword) {
      toast({
        variant: 'destructive',
        title: 'Masukkan password',
      });
      return;
    }

    setBusy(true);

    try {
      const res = await base44.functions.invoke('databaseReset', {
        mode: resetMode,
        resetSequences,
        skipBackup,
        confirm: resetPhrase,
      });

      toast({
        title: 'Reset selesai',
        description:
          `Mode ${resetMode} • ${res.data?.sequencesReset || 0} sequence direset`,
      });

      setResetOpen(false);
      setResetPhrase('');
      setResetAck(false);
      setResetPassword('');
      loadBackups();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Reset gagal',
        description: error.response?.data?.error || error.message,
      });
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async () => {
    if (!restoreId) {
      toast({
        variant: 'destructive',
        title: 'Pilih backup',
      });
      return;
    }

    if (restorePhrase !== RESTORE_CONFIRM_PHRASE) {
      toast({
        variant: 'destructive',
        title: 'Kalimat konfirmasi belum sesuai',
      });
      return;
    }

    if (!restoreAck) {
      toast({
        variant: 'destructive',
        title: 'Centang pemahaman risiko',
      });
      return;
    }

    setBusy(true);

    try {
      const res = await base44.functions.invoke('databaseRestore', {
        backup_id: restoreId,
        mode: restoreMode,
        confirm: restorePhrase,
        autoBackup: true,
      });

      toast({
        title: 'Restore selesai',
        description: res.data?.backup_code,
      });

      setRestoreOpen(false);
      setRestorePhrase('');
      setRestoreAck(false);
      setRestoreId('');
      loadBackups();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Restore gagal',
        description: error.response?.data?.error || error.message,
      });
    } finally {
      setBusy(false);
    }
  };

  const resetFileState = () => {
    setUploadedFile(null);
    setPreview(null);
    setValidateError('');
    setNeedsPassword(false);
    setFilePassword('');
    setFilePhrase('');
    setFileAck(false);
    setRestoreProgress(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const validateFile = async (fileUri, fileName, fileSize, password) => {
    setValidateError('');
    setPreview(null);
    setNeedsPassword(false);

    try {
      const res = await base44.functions.invoke('databaseValidateRestoreFile', {
        file_uri: fileUri,
        file_name: fileName,
        file_size: fileSize,
        password,
      });

      setPreview(res.data?.preview);
      setNeedsPassword(false);
    } catch (error) {
      const data = error.response?.data;

      if (data?.needsPassword) {
        setNeedsPassword(true);
        setValidateError(
          data.error || 'File terenkripsi, masukkan password'
        );
      } else {
        setValidateError(
          data?.error || error.message || 'Validasi gagal'
        );
        setNeedsPassword(false);
      }
    }
  };

  const onPickFile = async (event) => {
    if (resumableSession) {
      toast({
        variant: 'destructive',
        title: 'Masih ada restore yang belum selesai',
        description: 'Lanjutkan restore checkpoint terlebih dahulu.',
      });
      return;
    }

    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_RESTORE_FILE_SIZE) {
      toast({
        variant: 'destructive',
        title: 'File terlalu besar',
        description: `Maksimum ${MAX_RESTORE_FILE_SIZE / 1048576} MB`,
      });
      return;
    }

    setBusy(true);
    resetFileState();

    try {
      const up = await base44.integrations.Core.UploadPrivateFile({ file });

      setUploadedFile({
        file_uri: up.file_uri,
        file_name: file.name,
        file_size: file.size,
      });

      await validateFile(
        up.file_uri,
        file.name,
        file.size,
        undefined
      );
    } catch (error) {
      setValidateError(
        error.response?.data?.error ||
          error.message ||
          'Gagal mengupload file'
      );
    } finally {
      setBusy(false);
    }
  };

  const revalidateWithPassword = async () => {
    if (!uploadedFile || !filePassword) {
      toast({
        variant: 'destructive',
        title: 'Masukkan password',
      });
      return;
    }

    setBusy(true);
    try {
      await validateFile(
        uploadedFile.file_uri,
        uploadedFile.file_name,
        uploadedFile.file_size,
        filePassword
      );
    } finally {
      setBusy(false);
    }
  };

  const invokeRestoreBatchWithRetry = async (sessionId) => {
    let lastError = null;

    for (
      let attempt = 0;
      attempt < MAX_NETWORK_RETRIES;
      attempt += 1
    ) {
      try {
        return await base44.functions.invoke('databaseRestoreBatch', {
          session_id: sessionId,
        });
      } catch (error) {
        lastError = error;

        if (!isTransientNetworkError(error)) {
          throw error;
        }

        if (attempt >= MAX_NETWORK_RETRIES - 1) {
          break;
        }

        const delay =
          NETWORK_RETRY_DELAYS[
            Math.min(attempt, NETWORK_RETRY_DELAYS.length - 1)
          ];

        setRestoreProgress((current) => ({
          ...(current || {}),
          status: 'RETRYING',
          message:
            `Koneksi terputus. Mencoba kembali ` +
            `${attempt + 1}/${MAX_NETWORK_RETRIES - 1} ` +
            `dalam ${Math.ceil(delay / 1000)} detik...`,
        }));

        await wait(delay);
      }
    }

    const finalError =
      lastError instanceof Error
        ? lastError
        : new Error(String(lastError || 'Koneksi restore gagal'));

    finalError.recoverable = true;
    throw finalError;
  };

  const mapBatchProgress = (progress, sessionMeta = {}) => ({
    status: progress.status || 'RUNNING',
    phase: progress.phase || 'RESTORE',
    percent: Number(progress.progress_percent || 0),
    operation: progress.operation || '',
    entity:
      progress.current_entity ||
      progress.completed_entity ||
      '',
    fields: Array.isArray(progress.current_fields)
      ? progress.current_fields
      : [],
    strategy: progress.strategy || '',
    batch: Number(progress.batch || 0),
    totalBatches: Number(progress.total_batches || 0),
    batchFrom: Number(progress.batch_from || 0),
    batchTo: Number(progress.batch_to || 0),
    batchWritten: Number(progress.batch_written || 0),
    entityProcessed: Number(
      progress.entity_processed ??
        progress.current_offset ??
        0
    ),
    entityRecords: Number(progress.entity_records || 0),
    totalProcessed: Number(progress.total_processed || 0),
    totalRecords: Number(
      progress.total_records ||
        sessionMeta.total_records ||
        sessionMeta.totalRecords ||
        0
    ),
    deleteCompleted: Number(progress.delete_completed || 0),
    deleteTotal: Number(progress.delete_total || 0),
    sessionCode:
      progress.session_code ||
      sessionMeta.session_code ||
      sessionMeta.sessionCode ||
      '',
    backupCode:
      progress.backup_code ||
      sessionMeta.backup_code ||
      sessionMeta.backupCode ||
      '',
    message:
      progress.message ||
      (
        progress.phase === 'DELETE'
          ? `Menghapus data lama ${progress.current_entity || ''}...`
          : progress.phase === 'VERIFY'
            ? 'Memverifikasi hasil restore...'
            : progress.phase === 'COMPLETED'
              ? 'Restore selesai 100%.'
              : `Menulis ${progress.current_entity || 'data'}...`
      ),
  });

  const runRestoreSession = async (
    sessionMeta,
    { isResume = true } = {}
  ) => {
    const sessionId = sessionMeta?.id;
    if (!sessionId) return;

    setBusy(true);
    setRestoreRunning(true);

    setRestoreProgress((current) => ({
      ...(current || {}),
      status: 'RUNNING',
      phase: current?.phase || 'RESTORE',
      entity: current?.entity || sessionMeta.current_entity || '',
      entityProcessed: Number(
        current?.entityProcessed ??
          sessionMeta.current_offset ??
          0
      ),
      totalRecords: Number(
        current?.totalRecords ||
          sessionMeta.total_records ||
          sessionMeta.totalRecords ||
          0
      ),
      sessionCode:
        sessionMeta.session_code ||
        sessionMeta.sessionCode ||
        '',
      backupCode:
        sessionMeta.backup_code ||
        sessionMeta.backupCode ||
        '',
      message: isResume
        ? 'Melanjutkan restore dari checkpoint terakhir...'
        : 'Restore session siap. Memulai proses batch...',
    }));

    try {
      let done = false;
      let safetyCounter = 0;

      while (!done) {
        safetyCounter += 1;

        if (safetyCounter > 20000) {
          throw new Error(
            'Restore dihentikan karena jumlah batch melebihi batas keamanan.'
          );
        }

        const batchRes =
          await invokeRestoreBatchWithRetry(sessionId);

        const progress = batchRes?.data || {};

        if (
          progress.status === 'FAILED' ||
          progress.ok === false
        ) {
          const restoreError = new Error(
            progress.error ||
              `Restore gagal pada ${
                progress.error_entity || 'entity tidak diketahui'
              }`
          );

          restoreError.restoreData = progress;
          throw restoreError;
        }

        setRestoreProgress(
          mapBatchProgress(progress, sessionMeta)
        );

        done =
          progress.done === true ||
          progress.status === 'COMPLETED';

        if (!done) {
          await wait(150);
        }
      }

      clearActiveRestoreSession();

      setRestoreProgress((current) => ({
        ...current,
        status: 'COMPLETED',
        phase: 'COMPLETED',
        percent: 100,
        message: 'Restore selesai dan terverifikasi 100%.',
      }));

      toast({
        title: 'Restore dari file selesai',
        description: `${
          sessionMeta.backup_code ||
          sessionMeta.backupCode ||
          ''
        } · 100% verified`,
      });

      await wait(800);

      setFileOpen(false);
      resetFileState();
      loadBackups();
    } catch (error) {
      const errorData =
        error?.response?.data ||
        error?.restoreData ||
        {};

      const errorMessage =
        errorData.error ||
        error?.message ||
        'Restore gagal';

      const recoverable =
        error?.recoverable ||
        isTransientNetworkError(error);

      setRestoreProgress((current) => ({
        ...(current || {}),
        status: recoverable ? 'PAUSED' : 'FAILED',
        phase: current?.phase || 'RESTORE',
        message: recoverable
          ? 'Koneksi terputus setelah beberapa percobaan. Restore dapat dilanjutkan dari checkpoint terakhir.'
          : errorMessage,
        errorEntity:
          errorData.error_entity ||
          current?.entity ||
          '',
        errorOffset: Number(
          errorData.error_offset ??
            current?.entityProcessed ??
            0
        ),
        errorFields: Array.isArray(errorData.error_fields)
          ? errorData.error_fields
          : [],
      }));

      if (recoverable) {
        setResumableSession(sessionMeta);

        localStorage.setItem(
          ACTIVE_RESTORE_STORAGE_KEY,
          JSON.stringify({
            id: sessionId,
            sessionCode:
              sessionMeta.session_code ||
              sessionMeta.sessionCode ||
              '',
            backupCode:
              sessionMeta.backup_code ||
              sessionMeta.backupCode ||
              '',
            fileName:
              sessionMeta.file_name ||
              sessionMeta.fileName ||
              '',
            totalRecords: Number(
              sessionMeta.total_records ||
              sessionMeta.totalRecords ||
              0
            ),
          })
        );

        toast({
          variant: 'destructive',
          title: 'Koneksi terputus',
          description:
            'Checkpoint aman. Klik Lanjutkan Restore untuk mencoba lagi.',
        });
      } else {
        clearActiveRestoreSession();

        toast({
          variant: 'destructive',
          title: 'Restore berhenti',
          description: errorData.error_entity
            ? `${errorData.error_entity} · ${errorMessage}`
            : errorMessage,
        });
      }
    } finally {
      setBusy(false);
      setRestoreRunning(false);
    }
  };

  const doFileRestore = async () => {
    if (resumableSession) {
      toast({
        variant: 'destructive',
        title: 'Masih ada restore yang belum selesai',
        description: 'Lanjutkan checkpoint restore terlebih dahulu.',
      });
      return;
    }

    if (!uploadedFile) {
      toast({
        variant: 'destructive',
        title: 'Pilih file backup',
      });
      return;
    }

    if (!preview) {
      toast({
        variant: 'destructive',
        title: 'File belum tervalidasi',
      });
      return;
    }

    if (filePhrase !== RESTORE_CONFIRM_PHRASE) {
      toast({
        variant: 'destructive',
        title: 'Kalimat konfirmasi belum sesuai',
      });
      return;
    }

    if (!fileAck) {
      toast({
        variant: 'destructive',
        title: 'Centang pemahaman risiko',
      });
      return;
    }

    if (preview?.encrypted || needsPassword) {
      toast({
        variant: 'destructive',
        title: 'Batch Restore belum mendukung file terenkripsi',
        description:
          'Gunakan backup tanpa enkripsi untuk Restore Batch V1.',
      });
      return;
    }

    setBusy(true);
    setRestoreRunning(true);

    setRestoreProgress({
      status: 'PREPARING',
      phase: 'PREPARE',
      percent: 0,
      entity: '',
      fields: [],
      batch: 0,
      totalBatches: 0,
      batchFrom: 0,
      batchTo: 0,
      entityProcessed: 0,
      entityRecords: 0,
      totalProcessed: 0,
      totalRecords: Number(
        preview?.recordCount ??
          preview?.record_count ??
          0
      ),
      message:
        'Memvalidasi backup dan membuat restore session...',
    });

    try {
      const prepareRes =
        await base44.functions.invoke(
          'databaseRestoreFromFile',
          {
            file_uri: uploadedFile.file_uri,
            file_name: uploadedFile.file_name,
            mode: fileMode,
            confirm: filePhrase,
            autoBackup: true,
            password: undefined,
          }
        );

      const prepare = prepareRes?.data || {};

      if (!prepare.ok || !prepare.session_id) {
        throw new Error('Restore session gagal dibuat.');
      }

      const activeSession = {
        id: prepare.session_id,
        session_code: prepare.session_code || '',
        backup_code: prepare.backup_code || '',
        file_name: uploadedFile.file_name,
        total_records: Number(prepare.total_records || 0),
        current_entity: '',
        current_offset: 0,
        status: prepare.status || 'READY',
      };

      setResumableSession(activeSession);

      localStorage.setItem(
        ACTIVE_RESTORE_STORAGE_KEY,
        JSON.stringify({
          id: activeSession.id,
          sessionCode: activeSession.session_code,
          backupCode: activeSession.backup_code,
          fileName: activeSession.file_name,
          totalRecords: activeSession.total_records,
        })
      );

      setRestoreProgress({
        status: prepare.status || 'READY',
        phase: 'PREPARE',
        percent: 0,
        entity: '',
        fields: [],
        batch: 0,
        totalBatches: 0,
        batchFrom: 0,
        batchTo: 0,
        entityProcessed: 0,
        entityRecords: 0,
        totalProcessed: Number(prepare.total_processed || 0),
        totalRecords: Number(prepare.total_records || 0),
        entityTotal: Number(prepare.entity_total || 0),
        entities: prepare.entities || [],
        sessionCode: prepare.session_code || '',
        backupCode: prepare.backup_code || '',
        message: 'Restore session siap. Memulai proses batch...',
      });

      await runRestoreSession(activeSession, {
        isResume: false,
      });
    } catch (error) {
      const errorData = error?.response?.data || {};
      const errorMessage =
        errorData.error ||
        error?.message ||
        'Restore preparation gagal';

      clearActiveRestoreSession();

      setRestoreProgress((current) => ({
        ...(current || {}),
        status: 'FAILED',
        phase: current?.phase || 'PREPARE',
        message: errorMessage,
        errorEntity: errorData.error_entity || '',
        errorOffset: Number(errorData.error_offset || 0),
        errorFields: Array.isArray(errorData.error_fields)
          ? errorData.error_fields
          : [],
      }));

      toast({
        variant: 'destructive',
        title: 'Restore gagal dipersiapkan',
        description: errorMessage,
      });
    } finally {
      setBusy(false);
      setRestoreRunning(false);
    }
  };

  const deleteBackup = async (backup) => {
    if (
      !window.confirm(
        `Hapus record backup ${backup.backup_code}? ` +
          '(metadata ditandai DELETED; file storage tetap)'
      )
    ) {
      return;
    }

    try {
      await base44.entities.DatabaseBackup.update(backup.id, {
        status: 'DELETED',
      });

      loadBackups();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Gagal',
        description: error.message,
      });
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader
        title="Database Management"
        description={`Environment: ${APP_ENVIRONMENT.toUpperCase()} • Khusus Administrator`}
      />

      {IS_PRODUCTION && (
        <div className="mb-4 bg-red-50 border border-red-300 rounded-lg px-4 py-3 text-[13px] text-red-700 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          Reset &amp; Restore dinonaktifkan pada environment Production. Backup &amp; Download tetap tersedia.
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-5">
        <Button
          onClick={() => setSaveOpen(true)}
          disabled={busy}
          className="gap-2"
        >
          <Save className="w-4 h-4" />
          Buat Backup
        </Button>

        <Button
          variant="outline"
          onClick={() => {
            resetFileState();
            setFileOpen(true);
          }}
          disabled={busy || IS_PRODUCTION}
          className="gap-2"
        >
          <FileUp className="w-4 h-4" />
          Restore dari File
        </Button>

        <Button
          variant="outline"
          onClick={() => setRestoreOpen(true)}
          disabled={busy || IS_PRODUCTION}
          className="gap-2"
        >
          <Upload className="w-4 h-4" />
          Restore Backup Tersimpan
        </Button>

        <Button
          variant="destructive"
          onClick={() => setResetOpen(true)}
          disabled={busy || IS_PRODUCTION}
          className="gap-2"
        >
          <RotateCcw className="w-4 h-4" />
          Reset Database
        </Button>
      </div>

      {lastBackup && (
        <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <div>
              <div className="font-semibold">
                Backup terakhir berhasil
              </div>
              <div>
                {lastBackup.code} · {lastBackup.fileName} ·{' '}
                {fmtSize(lastBackup.size)}
              </div>
            </div>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={reDownloadLast}
            disabled={busy}
            className="gap-2"
          >
            <Download className="w-4 h-4" />
            Download lagi
          </Button>
        </div>
      )}

      <div className="bg-white border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b font-semibold text-sm">
          Riwayat Backup
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Memuat backup...
          </div>
        ) : backups.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Belum ada backup.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-4 py-3">
                    Kode / Nama
                  </th>
                  <th className="text-left px-4 py-3">
                    Tipe
                  </th>
                  <th className="text-left px-4 py-3">
                    Dibuat
                  </th>
                  <th className="text-left px-4 py-3">
                    Ukuran
                  </th>
                  <th className="text-left px-4 py-3">
                    Status
                  </th>
                  <th className="text-right px-4 py-3">
                    Aksi
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y">
                {backups.map((backup) => (
                  <tr
                    key={backup.id}
                    className="hover:bg-slate-50"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">
                        {backup.backup_code || '-'}
                      </div>
                      <div className="text-xs text-slate-500">
                        {backup.backup_name ||
                          backup.file_name ||
                          '-'}
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      {backupTypeLabel(backup.backup_type)}
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap">
                      {fmtDate(backup.created_at)}
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap">
                      {fmtSize(backup.file_size)}
                    </td>

                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          statusColor[backup.status] ||
                          'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {backup.status || '-'}
                      </span>

                      {backup.encrypted && (
                        <Lock className="inline w-3 h-3 ml-1" />
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Download"
                          disabled={
                            busy ||
                            backup.status !== 'COMPLETED' ||
                            !downloadAllowed
                          }
                          onClick={() =>
                            downloadBackup(backup)
                          }
                        >
                          <Download className="w-4 h-4" />
                        </Button>

                        <Button
                          size="icon"
                          variant="ghost"
                          title="Hapus record"
                          disabled={
                            busy ||
                            backup.status === 'DELETED'
                          }
                          onClick={() =>
                            deleteBackup(backup)
                          }
                        >
                          <Trash2 className="w-4 h-4 text-red-600" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <FormModal
        open={saveOpen}
        onClose={() => !busy && setSaveOpen(false)}
        title="Buat Backup Database"
      >
        <div className="space-y-4">
          <div>
            <Label>Nama backup</Label>
            <Input
              value={bkName}
              onChange={(event) =>
                setBkName(event.target.value)
              }
              placeholder="Opsional"
            />
          </div>

          <div>
            <Label>Catatan</Label>
            <Textarea
              value={bkNotes}
              onChange={(event) =>
                setBkNotes(event.target.value)
              }
              placeholder="Opsional"
            />
          </div>

          <div>
            <Label>Tipe backup</Label>
            <select
              className="w-full h-10 rounded-md border px-3 bg-white"
              value={bkType}
              onChange={(event) =>
                setBkType(event.target.value)
              }
            >
              <option value="operational">
                Operational
              </option>
              <option value="data_only">
                Data Only
              </option>
              <option value="full">
                Full
              </option>
            </select>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="encrypt-backup">
              Enkripsi file
            </Label>

            <Switch
              id="encrypt-backup"
              checked={bkEncrypt}
              onCheckedChange={setBkEncrypt}
            />
          </div>

          {bkEncrypt && (
            <div>
              <Label>Password enkripsi</Label>
              <Input
                type="password"
                value={bkPassword}
                onChange={(event) =>
                  setBkPassword(event.target.value)
                }
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setSaveOpen(false)}
              disabled={busy}
            >
              Batal
            </Button>

            <Button
              onClick={doSave}
              disabled={busy}
            >
              {busy ? 'Memproses...' : 'Buat & Download'}
            </Button>
          </div>
        </div>
      </FormModal>

      <FormModal
        open={resetOpen}
        onClose={() => !busy && setResetOpen(false)}
        title="Reset Database"
      >
        <div className="space-y-4">
          <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
            Reset menghapus data sesuai mode yang dipilih. Backup otomatis dibuat kecuali opsi dilewati.
          </div>

          <div>
            <Label>Mode reset</Label>
            <select
              className="w-full h-10 rounded-md border px-3 bg-white"
              value={resetMode}
              onChange={(event) =>
                setResetMode(event.target.value)
              }
            >
              <option value="transaction">
                Transaction
              </option>
              <option value="full">
                Full
              </option>
            </select>
          </div>

          <div className="flex items-center justify-between">
            <Label>Reset sequence nomor</Label>
            <Switch
              checked={resetSequences}
              onCheckedChange={setResetSequences}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label>Lewati backup otomatis</Label>
            <Switch
              checked={skipBackup}
              onCheckedChange={setSkipBackup}
            />
          </div>

          <div>
            <Label>Ketik kalimat konfirmasi</Label>
            <Input
              value={resetPhrase}
              onChange={(event) =>
                setResetPhrase(event.target.value)
              }
              placeholder={RESET_CONFIRM_PHRASE}
            />
          </div>

          <label className="flex gap-2 items-start text-sm">
            <input
              type="checkbox"
              checked={resetAck}
              onChange={(event) =>
                setResetAck(event.target.checked)
              }
              className="mt-1"
            />
            Saya memahami data akan dihapus.
          </label>

          <div>
            <Label>Password administrator</Label>
            <Input
              type="password"
              value={resetPassword}
              onChange={(event) =>
                setResetPassword(event.target.value)
              }
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setResetOpen(false)}
              disabled={busy}
            >
              Batal
            </Button>

            <Button
              variant="destructive"
              onClick={doReset}
              disabled={busy}
            >
              {busy ? 'Memproses...' : 'Reset Database'}
            </Button>
          </div>
        </div>
      </FormModal>

      <FormModal
        open={restoreOpen}
        onClose={() => !busy && setRestoreOpen(false)}
        title="Restore Backup Tersimpan"
      >
        <div className="space-y-4">
          <div>
            <Label>Pilih backup</Label>
            <select
              className="w-full h-10 rounded-md border px-3 bg-white"
              value={restoreId}
              onChange={(event) =>
                setRestoreId(event.target.value)
              }
            >
              <option value="">
                Pilih backup...
              </option>

              {completedBackups.map((backup) => (
                <option
                  key={backup.id}
                  value={backup.id}
                >
                  {backup.backup_code} ·{' '}
                  {backup.backup_name ||
                    backup.file_name ||
                    '-'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label>Mode restore</Label>
            <select
              className="w-full h-10 rounded-md border px-3 bg-white"
              value={restoreMode}
              onChange={(event) =>
                setRestoreMode(event.target.value)
              }
            >
              <option value="operational">
                Operational
              </option>
              <option value="full">
                Full
              </option>
            </select>
          </div>

          <div>
            <Label>Ketik kalimat konfirmasi</Label>
            <Input
              value={restorePhrase}
              onChange={(event) =>
                setRestorePhrase(event.target.value)
              }
              placeholder={RESTORE_CONFIRM_PHRASE}
            />
          </div>

          <label className="flex gap-2 items-start text-sm">
            <input
              type="checkbox"
              checked={restoreAck}
              onChange={(event) =>
                setRestoreAck(event.target.checked)
              }
              className="mt-1"
            />
            Saya memahami data aktif akan diganti.
          </label>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setRestoreOpen(false)}
              disabled={busy}
            >
              Batal
            </Button>

            <Button
              onClick={doRestore}
              disabled={busy}
            >
              {busy ? 'Memproses...' : 'Mulai Restore'}
            </Button>
          </div>
        </div>
      </FormModal>

      <FormModal
        open={fileOpen}
        onClose={() => {
          if (restoreRunning) {
            toast({
              variant: 'destructive',
              title: 'Restore sedang berjalan',
              description:
                'Tunggu proses restore selesai sebelum menutup jendela ini.',
            });
            return;
          }

          setFileOpen(false);
          resetFileState();
        }}
        title="Restore dari Backup File"
      >
        <div className="space-y-4">
          {resumableSession && !restoreRunning && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="font-semibold">
                Restore belum selesai ditemukan
              </div>

              <div className="mt-1 text-xs">
                {resumableSession.session_code ||
                  resumableSession.sessionCode ||
                  'Restore session'}
                {' · '}
                {resumableSession.current_entity ||
                  'checkpoint tersimpan'}

                {Number.isFinite(
                  Number(resumableSession.current_offset)
                )
                  ? ` · offset ${Number(
                      resumableSession.current_offset
                    )}`
                  : ''}
              </div>

              <Button
                className="mt-3"
                onClick={() =>
                  runRestoreSession(resumableSession, {
                    isResume: true,
                  })
                }
                disabled={busy || resumeChecking}
              >
                {resumeChecking
                  ? 'Memeriksa session...'
                  : 'Lanjutkan Restore'}
              </Button>
            </div>
          )}

          <div>
            <Label>File backup JSON</Label>
            <Input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={onPickFile}
              disabled={
                busy ||
                restoreRunning ||
                !!resumableSession
              }
            />
          </div>

          {uploadedFile && (
            <div className="rounded-md border p-3 text-sm">
              <div className="font-medium">
                {uploadedFile.file_name}
              </div>
              <div className="text-xs text-slate-500">
                {fmtSize(uploadedFile.file_size)}
              </div>
            </div>
          )}

          {needsPassword && (
            <div className="space-y-2">
              <Label>Password file</Label>
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={filePassword}
                  onChange={(event) =>
                    setFilePassword(event.target.value)
                  }
                  disabled={restoreRunning}
                />
                <Button
                  variant="outline"
                  onClick={revalidateWithPassword}
                  disabled={busy || restoreRunning}
                >
                  Validasi
                </Button>
              </div>
            </div>
          )}

          {validateError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {validateError}
            </div>
          )}

          {preview && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              <div className="font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                File valid
              </div>
              <div className="mt-1">
                {preview.backupId ||
                  preview.backupCode ||
                  preview.backup_code ||
                  uploadedFile?.file_name}
                {' · '}
                {preview.recordCount ??
                  preview.record_count ??
                  0}{' '}
                record
                {preview.encrypted
                  ? ' · terenkripsi'
                  : ''}
              </div>
            </div>
          )}

          {preview &&
            !restoreRunning &&
            !resumableSession && (
              <>
                <div>
                  <Label>Mode restore</Label>
                  <select
                    className="w-full h-10 rounded-md border px-3 bg-white"
                    value={fileMode}
                    onChange={(event) =>
                      setFileMode(event.target.value)
                    }
                  >
                    <option value="operational">
                      Operational
                    </option>
                    <option value="full">
                      Full
                    </option>
                  </select>
                </div>

                <div>
                  <Label>Ketik kalimat konfirmasi</Label>
                  <Input
                    value={filePhrase}
                    onChange={(event) =>
                      setFilePhrase(event.target.value)
                    }
                    placeholder={RESTORE_CONFIRM_PHRASE}
                  />
                </div>

                <label className="flex gap-2 items-start text-sm">
                  <input
                    type="checkbox"
                    checked={fileAck}
                    onChange={(event) =>
                      setFileAck(event.target.checked)
                    }
                    className="mt-1"
                  />
                  Saya memahami data aktif akan diganti.
                </label>
              </>
            )}

          {restoreProgress && (
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs text-slate-500">
                    {restoreProgress.phase || 'RESTORE'}
                  </div>
                  <div className="font-semibold">
                    {restoreProgress.message}
                  </div>
                </div>

                <div className="text-lg font-bold">
                  {Math.round(
                    Math.max(
                      0,
                      Math.min(
                        100,
                        Number(restoreProgress.percent || 0)
                      )
                    )
                  )}
                  %
                </div>
              </div>

              <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    restoreProgress.status === 'FAILED'
                      ? 'bg-red-500'
                      : restoreProgress.status === 'PAUSED'
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                  }`}
                  style={{
                    width: `${Math.max(
                      0,
                      Math.min(
                        100,
                        Number(restoreProgress.percent || 0)
                      )
                    )}%`,
                  }}
                />
              </div>

              {restoreProgress.entity && (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-500">
                      Entity
                    </span>
                    <div className="font-mono font-medium">
                      {restoreProgress.entity}
                    </div>
                  </div>

                  <div>
                    <span className="text-slate-500">
                      Batch
                    </span>
                    <div>
                      {restoreProgress.batch || 0}
                      {' / '}
                      {restoreProgress.totalBatches || 0}
                    </div>
                  </div>

                  <div>
                    <span className="text-slate-500">
                      Entity record
                    </span>
                    <div>
                      {restoreProgress.entityProcessed || 0}
                      {' / '}
                      {restoreProgress.entityRecords || 0}
                    </div>
                  </div>

                  <div>
                    <span className="text-slate-500">
                      Total record
                    </span>
                    <div>
                      {restoreProgress.totalProcessed || 0}
                      {' / '}
                      {restoreProgress.totalRecords || 0}
                    </div>
                  </div>
                </div>
              )}

              {Array.isArray(restoreProgress.fields) &&
                restoreProgress.fields.length > 0 && (
                  <div>
                    <div className="text-xs text-slate-500 mb-1">
                      Field yang ditulis
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {restoreProgress.fields.map((field) => (
                        <span
                          key={field}
                          className="px-1.5 py-0.5 rounded bg-slate-100 font-mono text-[10px]"
                        >
                          {field}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

              {restoreProgress.status === 'FAILED' && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-3 text-[11px] text-red-700">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="font-semibold">
                        Restore berhenti
                      </div>
                      <div className="mt-1">
                        {restoreProgress.message ||
                          'Restore berhenti karena error.'}
                      </div>
                    </div>
                  </div>

                  {restoreProgress.errorEntity && (
                    <div className="mt-3 pt-2 border-t border-red-200 space-y-1">
                      <div>
                        <span className="font-medium">
                          Entity:
                        </span>{' '}
                        <span className="font-mono">
                          {restoreProgress.errorEntity}
                        </span>
                      </div>

                      <div>
                        <span className="font-medium">
                          Record / Offset:
                        </span>{' '}
                        {Number(restoreProgress.errorOffset || 0) + 1}
                      </div>

                      {Array.isArray(
                        restoreProgress.errorFields
                      ) &&
                        restoreProgress.errorFields.length > 0 && (
                          <div>
                            <div className="font-medium mb-1">
                              Field record:
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {restoreProgress.errorFields.map(
                                (field) => (
                                  <span
                                    key={field}
                                    className="px-1.5 py-0.5 rounded bg-red-100 font-mono text-[10px]"
                                  >
                                    {field}
                                  </span>
                                )
                              )}
                            </div>
                          </div>
                        )}
                    </div>
                  )}
                </div>
              )}

              {restoreProgress.status === 'PAUSED' && (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-[11px] text-amber-800">
                  <div className="font-semibold">
                    Koneksi terputus — checkpoint tetap aman
                  </div>
                  <div className="mt-1">
                    {restoreProgress.message}
                  </div>

                  {resumableSession && !restoreRunning && (
                    <Button
                      size="sm"
                      className="mt-3"
                      onClick={() =>
                        runRestoreSession(resumableSession, {
                          isResume: true,
                        })
                      }
                      disabled={busy}
                    >
                      Lanjutkan Restore
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                if (!restoreRunning) {
                  setFileOpen(false);
                  resetFileState();
                }
              }}
              disabled={restoreRunning}
            >
              Batal
            </Button>

            <Button
              onClick={doFileRestore}
              disabled={
                busy ||
                restoreRunning ||
                !preview ||
                !!resumableSession
              }
            >
              {restoreRunning
                ? 'Restore berjalan...'
                : busy
                  ? 'Memproses...'
                  : 'Mulai Restore'}
            </Button>
          </div>
        </div>
      </FormModal>
    </div>
  );
}