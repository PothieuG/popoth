'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useForm, type FieldErrors } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { DRAWER_CONTENT_CLASSES } from '@/components/ui/drawer-content-classes'
import { ModalCloseX } from '@/components/ui/modal-close-x'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { InlineSpinner } from '@/components/ui/InlineSpinner'
import UserAvatar from '@/components/ui/UserAvatar'
import DropdownMenu from '@/components/ui/DropdownMenu'
import { useNotes, type Note } from '@/hooks/useNotes'
import { useProfile } from '@/hooks/useProfile'
import { useGroupMembers, type GroupMember } from '@/hooks/useGroupMembers'
import { noteFormSchema } from '@/lib/schemas/notes'
import {
  NOTE_CONTENT_MAX_CHARS,
  NOTE_KINDS,
  SHOPPING_CHECKED_RETENTION_DAYS,
  type NoteKind,
} from '@/lib/constants/notes'
import { preventEnterSubmit } from '@/lib/forms/prevent-enter-submit'
import { cn } from '@/lib/utils'
import type { ProfileData } from '@/app/api/profile/route'

const ConfirmationDialog = dynamic(() => import('../ui/ConfirmationDialog'), { ssr: false })

type NoteFormInput = z.input<typeof noteFormSchema>
type NoteFormOutput = z.output<typeof noteFormSchema>

/**
 * Onglet ouvert à la fermeture du drawer, rouvert la fois suivante. Confort
 * propre au téléphone : si le stockage est indisponible, on ouvre Courses.
 */
const TAB_STORAGE_KEY = 'notes-drawer-tab'

function readStoredTab(): NoteKind {
  try {
    const stored = window.localStorage.getItem(TAB_STORAGE_KEY)
    return NOTE_KINDS.find((kind) => kind === stored) ?? 'shopping'
  } catch {
    return 'shopping'
  }
}

function storeTab(kind: NoteKind) {
  try {
    window.localStorage.setItem(TAB_STORAGE_KEY, kind)
  } catch {
    // Stockage bloqué (navigation privée…) : l'onglet ne sera pas retenu.
  }
}

interface TabConfig {
  label: string
  icon: string
  fieldLabel: string
  placeholder: string
  emptyTitle: string
  emptyHint: { profile: string; group: string }
  saveError: string
  deleteError: string
  deleteTitle: string
  deleteGroupMessage: string
}

const TABS: Record<NoteKind, TabConfig> = {
  shopping: {
    label: 'Courses',
    icon: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z',
    fieldLabel: 'Article de courses',
    placeholder: 'Ajouter un article…',
    emptyTitle: 'Liste de courses vide',
    emptyHint: {
      profile: 'Cochez un article une fois dans le panier.',
      group: 'Partagée avec tous les membres du groupe. Cochez un article une fois dans le panier.',
    },
    saveError: "L'article n'a pas pu être enregistré. Réessayez.",
    deleteError: "L'article n'a pas pu être supprimé. Réessayez.",
    deleteTitle: 'Supprimer cet article ?',
    deleteGroupMessage: 'Il disparaîtra aussi pour les autres membres du groupe.',
  },
  note: {
    label: 'Notes',
    icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    fieldLabel: 'Contenu de la note',
    placeholder: 'Écrire un pense-bête…',
    emptyTitle: "Aucune note pour l'instant",
    emptyHint: {
      profile: 'Vos notes restent privées.',
      group: 'Les notes ajoutées ici sont visibles par tous les membres du groupe.',
    },
    saveError: "La note n'a pas pu être enregistrée. Réessayez.",
    deleteError: "La note n'a pas pu être supprimée. Réessayez.",
    deleteTitle: 'Supprimer cette note ?',
    deleteGroupMessage: 'Elle disparaîtra aussi pour les autres membres du groupe.',
  },
  project: {
    label: 'Projets',
    icon: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
    fieldLabel: 'Projet',
    placeholder: 'Ajouter un projet…',
    emptyTitle: "Aucun projet pour l'instant",
    emptyHint: {
      profile: 'Une ligne par projet ou idée.',
      group: 'Les projets ajoutés ici sont visibles par tous les membres du groupe.',
    },
    saveError: "Le projet n'a pas pu être enregistré. Réessayez.",
    deleteError: "Le projet n'a pas pu être supprimé. Réessayez.",
    deleteTitle: 'Supprimer ce projet ?',
    deleteGroupMessage: 'Il disparaîtra aussi pour les autres membres du groupe.',
  },
}

/**
 * Résout l'auteur d'une note en `ProfileData` pour `<UserAvatar>`.
 *
 * L'avatar ne voyage jamais avec la note (règle Part 42 §11) : il vient du
 * profil courant (ses propres notes) ou de la liste des membres du groupe,
 * déjà en cache via l'en-tête du dashboard groupe. Repli sur le JOIN
 * `created_by` (initiales seules) pour un auteur qui a quitté le groupe.
 */
export function resolveNoteAuthor(
  note: Pick<Note, 'created_by_profile_id' | 'created_by'>,
  profile: ProfileData | null,
  members: GroupMember[],
): ProfileData | null {
  const authorId = note.created_by_profile_id
  if (!authorId) return null
  if (profile && profile.id === authorId) return profile

  const member = members.find((m) => m.id === authorId)
  const names = member ?? note.created_by
  if (!names) return null
  return {
    id: authorId,
    first_name: names.first_name ?? '',
    last_name: names.last_name ?? '',
    salary: 0,
    group_id: null,
    group_name: null,
    avatar_url: member?.avatar_url ?? null,
    created_at: null,
    updated_at: null,
  }
}

/** « 23 sept. » — l'année n'apparaît que si elle diffère de l'année en cours. */
export function formatNoteDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  const sameYear = date.getFullYear() === now.getFullYear()
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date)
}

/**
 * Courses : à acheter d'abord (ordre de l'API, plus récents en tête), puis
 * les articles cochés, derniers cochés en tête.
 */
export function splitShoppingItems(items: Note[]): { pending: Note[]; checked: Note[] } {
  const pending = items.filter((item) => !item.checked_at)
  const checked = items
    .filter((item) => item.checked_at)
    .sort((a, b) => Date.parse(b.checked_at ?? '') - Date.parse(a.checked_at ?? ''))
  return { pending, checked }
}

interface NoteFormProps {
  idPrefix: string
  label: string
  multiline: boolean
  defaultContent?: string
  placeholder?: string
  submitLabel: string
  submittingLabel: string
  serverErrorMessage: string
  onSubmit: (content: string) => Promise<boolean>
  onCancel?: () => void
  resetOnSuccess?: boolean
  autoFocus?: boolean
}

/**
 * Formulaire d'une note (ajout en tête de l'onglet, ou édition en place).
 * `react-hook-form` + `zodResolver(noteFormSchema)` : même validation que le
 * serveur (trim, non vide, ≤ NOTE_CONTENT_MAX_CHARS).
 *
 * `multiline` : zone de texte (onglet Notes) ; sinon champ d'une ligne
 * (Courses, Projets). En ajout sur une ligne, le bouton est à droite du champ
 * et le champ garde le focus : on enchaîne les articles sans rouvrir le clavier.
 */
function NoteForm({
  idPrefix,
  label,
  multiline,
  defaultContent = '',
  placeholder,
  submitLabel,
  submittingLabel,
  serverErrorMessage,
  onSubmit,
  onCancel,
  resetOnSuccess = false,
  autoFocus = false,
}: NoteFormProps) {
  const [serverError, setServerError] = useState<string | null>(null)
  const form = useForm<NoteFormInput, undefined, NoteFormOutput>({
    resolver: zodResolver(noteFormSchema),
    defaultValues: { content: defaultContent },
  })
  const { isSubmitting, errors } = form.formState
  const fieldId = `${idPrefix}-content`
  const errorId = `${idPrefix}-content-error`
  const inline = !multiline && !onCancel

  const onValidSubmit = async ({ content }: NoteFormOutput) => {
    setServerError(null)
    const ok = await onSubmit(content)
    if (!ok) {
      setServerError(serverErrorMessage)
      return
    }
    if (resetOnSuccess) {
      form.reset({ content: '' })
      if (inline) form.setFocus('content')
    }
  }

  const onInvalidSubmit = (formErrors: FieldErrors<NoteFormInput>) => {
    if (formErrors.content) form.setFocus('content')
  }

  const fieldProps = {
    id: fieldId,
    maxLength: NOTE_CONTENT_MAX_CHARS,
    placeholder,
    autoFocus,
    'aria-invalid': errors.content ? true : undefined,
    'aria-describedby': errors.content ? errorId : undefined,
    ...form.register('content'),
  }

  const buttons = (
    <div className="flex shrink-0 justify-end gap-2">
      {onCancel && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Annuler
        </Button>
      )}
      <Button
        type="submit"
        size="sm"
        disabled={isSubmitting}
        // Le champ garde le focus au tap : le clavier mobile reste ouvert.
        onMouseDown={inline ? (e) => e.preventDefault() : undefined}
        className={cn('bg-slate-700 text-white hover:bg-slate-800', inline && 'h-9')}
      >
        {isSubmitting && <InlineSpinner className="mr-1.5" />}
        {isSubmitting ? submittingLabel : submitLabel}
      </Button>
    </div>
  )

  return (
    <form
      onSubmit={form.handleSubmit(onValidSubmit, onInvalidSubmit)}
      onKeyDown={preventEnterSubmit}
      noValidate
      className="space-y-2"
    >
      <label htmlFor={fieldId} className="sr-only">
        {label}
      </label>
      {multiline ? (
        <>
          <Textarea {...fieldProps} rows={3} className="min-h-0 resize-none bg-white" />
          {buttons}
        </>
      ) : inline ? (
        <div className="flex items-center gap-2">
          <Input {...fieldProps} className="h-9 min-w-0 flex-1 bg-white" />
          {buttons}
        </div>
      ) : (
        <>
          <Input {...fieldProps} className="h-9 bg-white" />
          {buttons}
        </>
      )}
      {errors.content && (
        <p id={errorId} className="text-xs text-red-600">
          {errors.content.message}
        </p>
      )}
      {serverError && (
        <p role="alert" className="text-xs text-red-600">
          {serverError}
        </p>
      )}
    </form>
  )
}

const EDIT_ICON =
  'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z'
const DELETE_ICON =
  'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16'

function MenuIcon({ path }: { path: string }) {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={path} />
    </svg>
  )
}

function NoteItemMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <DropdownMenu
      items={[
        { label: 'Modifier', icon: <MenuIcon path={EDIT_ICON} />, onClick: onEdit },
        {
          label: 'Supprimer',
          variant: 'danger',
          icon: <MenuIcon path={DELETE_ICON} />,
          onClick: onDelete,
        },
      ]}
    />
  )
}

interface NotesDrawerProps {
  isOpen: boolean
  onClose: () => void
  context: 'profile' | 'group'
}

/**
 * Drawer plein écran des notes / pense-bêtes (Sprint Notes-Pense-Betes
 * 2026-09-23). Ouvert depuis la demi-ligne « Notes » de `<FinancialIndicators>`.
 *
 * 3 onglets (Sprint Notes-Tabs 2026-10-03), rouvert sur le dernier utilisé :
 * - Courses : liste à cocher ; un article coché est légèrement barré, passe
 *   en bas, et disparaît 7 jours plus tard (ménage fait par l'API) ;
 * - Notes : texte libre, l'avatar de l'auteur précède chaque note ;
 * - Projets : liste simple, une ligne par projet.
 *
 * Perso : privé. Groupe : partagé, visible et modifiable par tous les membres.
 *
 * Aucun fetch propre à l'ouverture : `useNotes` partage la query déjà montée
 * par `<FinancialIndicators>` (compteur), `useGroupMembers` celle de l'en-tête.
 */
export default function NotesDrawer({ isOpen, onClose, context }: NotesDrawerProps) {
  const { notes, loading, isFetching, error, addNote, updateNote, toggleChecked, deleteNote } =
    useNotes(context)
  const { profile } = useProfile()
  const { members } = useGroupMembers(profile?.group_id, { enabled: context === 'group' })

  const [activeTab, setActiveTab] = useState<NoteKind>(readStoredTab)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Note | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const isGroup = context === 'group'
  const subtitle = isGroup ? 'Partagées avec votre groupe' : 'Visibles par vous seul'
  const tab = TABS[activeTab]
  const items = notes.filter((note) => note.kind === activeTab)

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setEditingId(null)
      onClose()
    }
  }

  const selectTab = (kind: NoteKind) => {
    setActiveTab(kind)
    storeTab(kind)
    setEditingId(null)
    setActionError(null)
  }

  const handleToggle = async (item: Note) => {
    setActionError(null)
    const ok = await toggleChecked(item.id, !item.checked_at)
    if (!ok) setActionError("L'article n'a pas pu être mis à jour. Réessayez.")
  }

  const handleConfirmDelete = async () => {
    if (!deleting) return
    setIsDeleting(true)
    setActionError(null)
    const ok = await deleteNote(deleting.id)
    setIsDeleting(false)
    if (!ok) setActionError(TABS[deleting.kind].deleteError)
    setDeleting(null)
  }

  const startDelete = (item: Note) => {
    setActionError(null)
    setDeleting(item)
  }

  const renderEditForm = (item: Note) => (
    <NoteForm
      idPrefix={`edit-note-${item.id}`}
      label={TABS[item.kind].fieldLabel}
      multiline={item.kind === 'note'}
      defaultContent={item.content}
      submitLabel="Enregistrer"
      submittingLabel="Enregistrement..."
      serverErrorMessage={TABS[item.kind].saveError}
      autoFocus
      onCancel={() => setEditingId(null)}
      onSubmit={async (content) => {
        const ok = await updateNote(item.id, content)
        if (ok) setEditingId(null)
        return ok
      }}
    />
  )

  const renderNote = (note: Note) => {
    const author = resolveNoteAuthor(note, profile, members)
    const isMine = !!profile && note.created_by_profile_id === profile.id
    const authorName = isMine ? 'Vous' : author?.first_name || 'Ancien membre'
    const isEditing = editingId === note.id

    return (
      <li key={note.id} className="flex gap-3 py-3">
        <UserAvatar profile={author} size="sm" className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-1.5 text-xs">
            <span className="truncate font-medium text-gray-900">{authorName}</span>
            <span className="shrink-0 text-gray-500">{formatNoteDate(note.created_at)}</span>
          </p>
          {isEditing ? (
            <div className="mt-1.5">{renderEditForm(note)}</div>
          ) : (
            <p className="mt-0.5 text-sm break-words whitespace-pre-wrap text-gray-800">
              {note.content}
            </p>
          )}
        </div>
        {!isEditing && (
          <NoteItemMenu onEdit={() => setEditingId(note.id)} onDelete={() => startDelete(note)} />
        )}
      </li>
    )
  }

  /** Ligne d'une liste simple : case à cocher (courses) ou puce (projets). */
  const renderListItem = (item: Note) => {
    const isEditing = editingId === item.id
    const isChecked = !!item.checked_at
    const checkboxId = `note-check-${item.id}`

    return (
      <li key={item.id} className="flex items-center gap-3 py-2">
        {isEditing ? (
          <div className="min-w-0 flex-1 py-1">{renderEditForm(item)}</div>
        ) : (
          <>
            {item.kind === 'shopping' ? (
              <>
                <input
                  id={checkboxId}
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => handleToggle(item)}
                  className="h-5 w-5 shrink-0 cursor-pointer accent-slate-600"
                />
                {/* Le libellé entier est cliquable : grande zone de tap en magasin. */}
                <label
                  htmlFor={checkboxId}
                  className={cn(
                    'min-w-0 flex-1 cursor-pointer py-1 text-sm break-words',
                    isChecked ? 'text-gray-400 line-through decoration-gray-300' : 'text-gray-800',
                  )}
                >
                  {item.content}
                </label>
              </>
            ) : (
              <>
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400"
                />
                <p className="min-w-0 flex-1 py-1 text-sm break-words text-gray-800">
                  {item.content}
                </p>
              </>
            )}
            <NoteItemMenu onEdit={() => setEditingId(item.id)} onDelete={() => startDelete(item)} />
          </>
        )}
      </li>
    )
  }

  const renderList = () => {
    if (loading || isFetching) {
      return (
        <div className="space-y-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className={activeTab === 'note' ? 'h-16 w-full' : 'h-9 w-full'} />
          ))}
        </div>
      )
    }

    if (error) {
      return (
        <p role="alert" className="py-8 text-center text-sm text-red-600">
          Impossible de charger les notes. Tirez l&apos;écran vers le bas pour réessayer.
        </p>
      )
    }

    if (items.length === 0) {
      return (
        <div className="py-10 text-center">
          <p className="font-medium text-gray-700">{tab.emptyTitle}</p>
          <p className="mt-1 text-sm text-gray-500">{tab.emptyHint[context]}</p>
        </div>
      )
    }

    if (activeTab === 'note') {
      return <ul className="divide-y divide-gray-100">{items.map(renderNote)}</ul>
    }

    if (activeTab === 'project') {
      return <ul className="divide-y divide-gray-100">{items.map(renderListItem)}</ul>
    }

    const { pending, checked } = splitShoppingItems(items)
    return (
      <>
        {pending.length > 0 && (
          <ul className="divide-y divide-gray-100">{pending.map(renderListItem)}</ul>
        )}
        {checked.length > 0 && (
          <section aria-labelledby="notes-checked-heading" className="mt-3">
            <h3 id="notes-checked-heading" className="py-1 text-xs font-medium text-gray-500">
              Dans le panier · retirés au bout de {SHOPPING_CHECKED_RETENTION_DAYS} jours
            </h3>
            <ul className="divide-y divide-gray-100">{checked.map(renderListItem)}</ul>
          </section>
        )}
      </>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent hideCloseButton className={DRAWER_CONTENT_CLASSES}>
        {/* Header - Sticky (harmonisé avec PlanningDrawer, teinte ardoise neutre) */}
        <div className="shrink-0 border-b border-gray-200 bg-slate-50/50 px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-600">
                <svg
                  className="h-5 w-5 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d={TABS.note.icon}
                  />
                </svg>
              </div>
              <div>
                <DialogTitle asChild>
                  <h2 className="text-xl font-bold text-gray-900">Notes</h2>
                </DialogTitle>
                <DialogDescription asChild>
                  <p className="text-sm text-gray-600">{subtitle}</p>
                </DialogDescription>
              </div>
            </div>
            <ModalCloseX
              onClose={onClose}
              variant="circle"
              className="h-10 w-10"
              svgClassName="h-5 w-5 text-gray-600"
            />
          </div>
        </div>

        {/* Onglets (même gabarit que PlanningDrawer) */}
        <div className="shrink-0 border-b border-gray-200 px-4 py-2">
          <div
            role="tablist"
            aria-label="Type de notes"
            className="flex rounded-lg bg-gray-100 p-1"
          >
            {NOTE_KINDS.map((kind) => {
              const selected = kind === activeTab
              return (
                <button
                  key={kind}
                  id={`notes-tab-${kind}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={selected ? `notes-panel-${kind}` : undefined}
                  onClick={() => selectTab(kind)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-sm font-medium transition-all duration-200',
                    selected
                      ? 'bg-white text-slate-800 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900',
                  )}
                >
                  <svg
                    className="h-4 w-4 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d={TABS[kind].icon}
                    />
                  </svg>
                  <span>{TABS[kind].label}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div
          role="tabpanel"
          id={`notes-panel-${activeTab}`}
          aria-labelledby={`notes-tab-${activeTab}`}
          className="flex min-h-0 flex-1 flex-col"
        >
          {/* Ajout — `key` : un brouillon ne passe pas d'un onglet à l'autre */}
          <div className="shrink-0 border-b border-gray-200 px-4 py-3">
            <NoteForm
              key={activeTab}
              idPrefix={`new-${activeTab}`}
              label={tab.fieldLabel}
              multiline={activeTab === 'note'}
              placeholder={tab.placeholder}
              submitLabel="Ajouter"
              submittingLabel="Ajout..."
              serverErrorMessage={tab.saveError}
              resetOnSuccess
              onSubmit={(content) => addNote(content, activeTab)}
            />
          </div>

          {/* Liste */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-2">
            {actionError && (
              <p role="alert" className="py-2 text-sm text-red-600">
                {actionError}
              </p>
            )}
            {renderList()}
          </div>
        </div>

        {deleting && (
          <ConfirmationDialog
            isOpen
            onClose={() => setDeleting(null)}
            onConfirm={handleConfirmDelete}
            title={TABS[deleting.kind].deleteTitle}
            message={
              isGroup ? TABS[deleting.kind].deleteGroupMessage : 'Cette action est définitive.'
            }
            details={
              <p className="line-clamp-3 rounded-md bg-gray-50 px-3 py-2 text-sm break-words whitespace-pre-wrap text-gray-700">
                {deleting.content}
              </p>
            }
            confirmText="Supprimer"
            variant="danger"
            loading={isDeleting}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
