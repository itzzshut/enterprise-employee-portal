import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from '@core/services/api.service';
import { AuthService } from '@core/services/auth.service';
import { NotificationService } from '@core/services/notification.service';
import { UiBadgeComponent } from '@shared/ui-badge/ui-badge.component';
import { UiButtonComponent } from '@shared/ui-button/ui-button.component';
import { UiCardComponent } from '@shared/ui-card/ui-card.component';
import { UiEmptyStateComponent } from '@shared/ui-empty-state/ui-empty-state.component';
import { UiModalComponent } from '@shared/ui-modal/ui-modal.component';
import type { DocumentRecord, Paginated } from '@core/models';

const CATEGORIES = ['GENERAL', 'CONTRACT', 'POLICY', 'PAYROLL', 'CERTIFICATE', 'ID_PROOF'] as const;

@Component({
  selector: 'app-documents',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    UiCardComponent,
    UiBadgeComponent,
    UiButtonComponent,
    UiEmptyStateComponent,
    UiModalComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>Documents</h1>
          <p class="mt-1 text-sm text-slate-500">
            Your contracts and certificates, plus company-wide policies.
          </p>
        </div>
        <app-ui-button (pressed)="uploadOpen.set(true)">Upload document</app-ui-button>
      </div>

      <app-ui-card [flush]="true">
        <div class="flex flex-wrap gap-1 border-b border-surface-border p-3">
          <button
            type="button"
            class="rounded-lg px-2.5 py-1 text-xs font-medium transition"
            [class]="category() === '' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'"
            (click)="setCategory('')"
          >
            All
          </button>
          @for (option of categories; track option) {
            <button
              type="button"
              class="rounded-lg px-2.5 py-1 text-xs font-medium transition"
              [class]="
                category() === option ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              "
              (click)="setCategory(option)"
            >
              {{ label(option) }}
            </button>
          }
        </div>

        @if (loading()) {
          <div class="divide-y divide-surface-border">
            @for (placeholder of [1, 2, 3]; track placeholder) {
              <div class="px-5 py-4">
                <span class="skeleton block h-4 w-56"></span>
                <span class="skeleton mt-2 block h-3 w-40"></span>
              </div>
            }
          </div>
        } @else if (documents().length === 0) {
          <app-ui-empty-state
            icon="🗎"
            heading="No documents here"
            message="Uploads appear here as soon as they are filed, along with anything People Operations publishes."
          />
        } @else {
          <ul class="divide-y divide-surface-border">
            @for (document of documents(); track document.id) {
              <li class="flex flex-wrap items-center gap-4 px-5 py-4">
                <span
                  class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-lg"
                  aria-hidden="true"
                  >{{ icon(document.mimeType) }}</span
                >

                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium text-slate-900">{{ document.title }}</p>
                  <p class="mt-0.5 text-xs text-slate-500">
                    {{ document.filename }} · {{ size(document.sizeBytes) }} ·
                    {{ document.createdAt | date: 'mediumDate' }} · by
                    {{ document.uploadedByName }}
                  </p>
                </div>

                <div class="flex shrink-0 items-center gap-2">
                  <app-ui-badge
                    [dot]="false"
                    [tone]="document.visibility === 'COMPANY' ? 'brand' : 'neutral'"
                    [text]="label(document.visibility)"
                  />
                  <app-ui-button size="sm" variant="secondary" (pressed)="download(document)">
                    Download
                  </app-ui-button>
                  @if (canDelete(document)) {
                    <app-ui-button size="sm" variant="ghost" (pressed)="remove(document)">
                      Delete
                    </app-ui-button>
                  }
                </div>
              </li>
            }
          </ul>
        }
      </app-ui-card>
    </div>

    <app-ui-modal
      heading="Upload a document"
      subheading="PDF, image or Office file up to 5MB."
      [open]="uploadOpen()"
      (closed)="uploadOpen.set(false)"
    >
      <div class="space-y-4">
        <div>
          <label class="form-label" for="doc-title">Title</label>
          <input id="doc-title" type="text" class="form-control" [(ngModel)]="title" />
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="form-label" for="doc-category">Category</label>
            <select id="doc-category" class="form-control" [(ngModel)]="uploadCategory">
              @for (option of categories; track option) {
                <option [value]="option">{{ label(option) }}</option>
              }
            </select>
          </div>

          <div>
            <label class="form-label" for="doc-visibility">Visibility</label>
            <select id="doc-visibility" class="form-control" [(ngModel)]="visibility">
              <option value="PRIVATE">Private — me and People Ops</option>
              <option value="MANAGER">My manager can see it</option>
              @if (auth.isHrAdmin()) {
                <option value="HR">People Operations only</option>
                <option value="COMPANY">Everyone in the company</option>
              }
            </select>
          </div>
        </div>

        <div>
          <label class="form-label" for="doc-file">File</label>
          <input
            id="doc-file"
            type="file"
            class="form-control"
            accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx"
            (change)="pickFile($event)"
          />
          @if (selectedFile()) {
            <p class="form-hint">
              {{ selectedFile()!.name }} · {{ size(selectedFile()!.size) }}
            </p>
          }
        </div>
      </div>

      <div modalFooter class="flex gap-2">
        <app-ui-button variant="secondary" size="sm" (pressed)="uploadOpen.set(false)">
          Cancel
        </app-ui-button>
        <app-ui-button
          size="sm"
          [loading]="uploading()"
          [disabled]="!selectedFile() || title.trim().length < 3"
          (pressed)="upload()"
        >
          Upload
        </app-ui-button>
      </div>
    </app-ui-modal>
  `,
})
export class DocumentsComponent {
  private readonly api = inject(ApiService);
  protected readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly categories = CATEGORIES;
  protected readonly documents = signal<DocumentRecord[]>([]);
  protected readonly loading = signal(true);
  protected readonly category = signal<string>('');
  protected readonly uploadOpen = signal(false);
  protected readonly uploading = signal(false);
  protected readonly selectedFile = signal<File | null>(null);

  protected title = '';
  protected uploadCategory: string = 'GENERAL';
  protected visibility = 'PRIVATE';

  constructor() {
    this.load();
  }

  protected label(value: string): string {
    const words = value.toLowerCase().split('_');
    return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }

  protected icon(mimeType: string): string {
    if (mimeType.startsWith('image/')) return '🖼';
    if (mimeType === 'application/pdf') return '📄';
    if (mimeType.includes('spreadsheet')) return '📊';
    return '🗂';
  }

  protected size(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  protected canDelete(document: DocumentRecord): boolean {
    return this.auth.isHrAdmin() || document.employeeId === this.auth.user()?.employeeId;
  }

  protected setCategory(value: string): void {
    this.category.set(value);
    this.load();
  }

  protected pickFile(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.selectedFile.set(file);
    if (file && !this.title.trim()) {
      // Seed the title from the filename — one less field to fill in.
      this.title = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
    }
  }

  protected upload(): void {
    const file = this.selectedFile();
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', this.title.trim());
    formData.append('category', this.uploadCategory);
    formData.append('visibility', this.visibility);

    this.uploading.set(true);
    this.api
      .upload<{ document: DocumentRecord }>('/documents', formData)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.uploading.set(false);
          this.uploadOpen.set(false);
          this.selectedFile.set(null);
          this.title = '';
          this.notifications.success('Document uploaded');
          this.load();
        },
        error: () => this.uploading.set(false),
      });
  }

  /**
   * Downloads go through HttpClient rather than a plain link so the
   * Authorization header is attached — the endpoint checks visibility per
   * document and would return 403 for an unauthenticated browser request.
   */
  protected download(document: DocumentRecord): void {
    this.api
      .download(`/documents/${document.id}/download`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((blob) => {
        const url = URL.createObjectURL(blob);
        const anchor = window.document.createElement('a');
        anchor.href = url;
        anchor.download = document.filename;
        anchor.click();
        URL.revokeObjectURL(url);
      });
  }

  protected remove(document: DocumentRecord): void {
    this.api
      .delete<void>(`/documents/${document.id}`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.notifications.success('Document deleted');
        this.load();
      });
  }

  private load(): void {
    this.loading.set(true);
    this.api
      .get<Paginated<DocumentRecord>>('/documents', {
        category: this.category() || undefined,
        pageSize: 50,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.documents.set(result.data);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }
}
