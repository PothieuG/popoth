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
import { Button } from '@/components/ui/button'
import { InlineSpinner } from '@/components/ui/InlineSpinner'
import UserAvatar from '@/components/ui/UserAvatar'
import DropdownMenu from '@/components/ui/DropdownMenu'
import { useNotes, type Note } from '@/hooks/useNotes'
import { useProfile } from '@/hooks/useProfile'
import { useGroupMembers, type GroupMember } from '@/hooks/useGroupMembers'
import { createNoteBodySchema } from '@/lib/schemas/notes'
import { NOTE_CONTENT_MAX_CHARS } from '@/lib/constants/notes'
import { preventEnterSubmit } from '@/lib/forms/prevent-enter-submit'
import { useFocusAfterSubmit } from '@/hooks/useFocusAfterSubmit'
import type { ProfileData } from '@/app/api/profile/route'

const ConfirmationDialog = dynamic(() => import('../ui/ConfirmationDialog'), { ssr: false })

type NoteFormInput = z.input<typeof createNoteBodySchema>
type NoteFormOutput = z.output<typeof createNoteBodySchema>

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

interface NoteFormProps {
  idPrefix: string
  defaultContent?: string
  placeholder?: string
  submitLabel: string
  submittingLabel: string
  onSubmit: (content: string) => Promise<boolean>
  onCancel?: () => void
  resetOnSuccess?: boolean
  autoFocus?: boolean
}

/**
 * Formulaire d'une note (ajout en tête du drawer, ou édition en place).
 * `react-hook-form` + `zodResolver(createNoteBodySchema)` : même validation
 * que le serveur (trim, non vide, ≤ NOTE_CONTENT_MAX_CHARS).
 */
function NoteForm({
  idPrefix,
  defaultContent = '',
  placeholder,
  submitLabel,
  submittingLabel,
  onSubmit,
  onCancel,
  resetOnSuccess = false,
  autoFocus = false,
}: NoteFormProps) {
  const [serverError, setServerError] = useState<string | null>(null)
  const form = useForm<NoteFormInput, undefined, NoteFormOutput>({
    resolver: zodResolver(createNoteBodySchema),
    defaultValues: { content: defaultContent },
  })
  const focusAfterSubmit = useFocusAfterSubmit(form.formState.submitCount)
  const { isSubmitting, errors } = form.formState
  const fieldId = `${idPrefix}-content`
  const errorId = `${idPrefix}-content-error`

  const onValidSubmit = async ({ content }: NoteFormOutput) => {
    setServerError(null)
    const ok = await onSubmit(content)
    if (!ok) {
      setServerError("La note n'a pas pu être enregistrée. Réessayez.")
      return
    }
    if (resetOnSuccess) form.reset({ content: '' })
  }

  const onInvalidSubmit = (formErrors: FieldErrors<NoteFormInput>) => {
    if (formErrors.content) focusAfterSubmit(() => form.setFocus('content'))
  }

  return (
    <form
      onSubmit={form.handleSubmit(onValidSubmit, onInvalidSubmit)}
      onKeyDown={preventEnterSubmit}
      noValidate
      className="space-y-2"
    >
      <label htmlFor={fieldId} className="sr-only">
        Contenu de la note
      </label>
      <Textarea
        id={fieldId}
        rows={3}
        maxLength={NOTE_CONTENT_MAX_CHARS}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-invalid={errors.content ? true : undefined}
        aria-describedby={errors.content ? errorId : undefined}
        className="min-h-0 resize-none bg-white"
        {...form.register('content')}
      />
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
      <div className="flex justify-end gap-2">
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
          className="bg-slate-700 text-white hover:bg-slate-800"
        >
          {isSubmitting && <InlineSpinner className="mr-1.5" />}
          {isSubmitting ? submittingLabel : submitLabel}
        </Button>
      </div>
    </form>
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
 * Perso : notes privées. Groupe : notes partagées, visibles et modifiables par
 * tous les membres ; l'avatar de l'auteur précède chaque note.
 *
 * Aucun fetch propre à l'ouverture : `useNotes` partage la query déjà montée
 * par `<FinancialIndicators>` (compteur), `useGroupMembers` celle de l'en-tête.
 */
export default function NotesDrawer({ isOpen, onClose, context }: NotesDrawerProps) {
  const { notes, loading, isFetching, error, addNote, updateNote, deleteNote } = useNotes(context)
  const { profile } = useProfile()
  const { members } = useGroupMembers(profile?.group_id, { enabled: context === 'group' })

  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Note | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const isGroup = context === 'group'
  const subtitle = isGroup ? 'Partagées avec votre groupe' : 'Visibles par vous seul'

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setEditingId(null)
      onClose()
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleting) return
    setIsDeleting(true)
    setDeleteError(null)
    const ok = await deleteNote(deleting.id)
    setIsDeleting(false)
    if (!ok) setDeleteError("La note n'a pas pu être supprimée. Réessayez.")
    setDeleting(null)
  }

  const renderList = () => {
    if (loading || isFetching) {
      return (
        <div className="space-y-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
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

    if (notes.length === 0) {
      return (
        <div className="py-10 text-center">
          <p className="font-medium text-gray-700">Aucune note pour l&apos;instant</p>
          <p className="mt-1 text-sm text-gray-500">
            {isGroup
              ? 'Les notes ajoutées ici sont visibles par tous les membres du groupe.'
              : 'Vos notes restent privées.'}
          </p>
        </div>
      )
    }

    return (
      <ul className="divide-y divide-gray-100">
        {notes.map((note) => {
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
                  <div className="mt-1.5">
                    <NoteForm
                      idPrefix={`edit-note-${note.id}`}
                      defaultContent={note.content}
                      submitLabel="Enregistrer"
                      submittingLabel="Enregistrement..."
                      autoFocus
                      onCancel={() => setEditingId(null)}
                      onSubmit={async (content) => {
                        const ok = await updateNote(note.id, content)
                        if (ok) setEditingId(null)
                        return ok
                      }}
                    />
                  </div>
                ) : (
                  <p className="mt-0.5 text-sm break-words whitespace-pre-wrap text-gray-800">
                    {note.content}
                  </p>
                )}
              </div>
              {!isEditing && (
                <DropdownMenu
                  items={[
                    {
                      label: 'Modifier',
                      icon: (
                        <svg
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                          />
                        </svg>
                      ),
                      onClick: () => setEditingId(note.id),
                    },
                    {
                      label: 'Supprimer',
                      variant: 'danger',
                      icon: (
                        <svg
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      ),
                      onClick: () => {
                        setDeleteError(null)
                        setDeleting(note)
                      },
                    },
                  ]}
                />
              )}
            </li>
          )
        })}
      </ul>
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
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
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

        {/* Nouvelle note */}
        <div className="shrink-0 border-b border-gray-200 px-4 py-3">
          <NoteForm
            idPrefix="new-note"
            placeholder="Écrire un pense-bête…"
            submitLabel="Ajouter"
            submittingLabel="Ajout..."
            resetOnSuccess
            onSubmit={addNote}
          />
        </div>

        {/* Liste */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-2">
          {deleteError && (
            <p role="alert" className="py-2 text-sm text-red-600">
              {deleteError}
            </p>
          )}
          {renderList()}
        </div>

        {deleting && (
          <ConfirmationDialog
            isOpen
            onClose={() => setDeleting(null)}
            onConfirm={handleConfirmDelete}
            title="Supprimer cette note ?"
            message={
              isGroup
                ? 'Elle disparaîtra aussi pour les autres membres du groupe.'
                : 'Cette action est définitive.'
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
