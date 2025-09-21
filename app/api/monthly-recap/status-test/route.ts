import { NextRequest, NextResponse } from 'next/server'

/**
 * API GET /api/monthly-recap/status-test
 * Version simplifiée pour tester la logique du récapitulatif mensuel
 */
export async function GET(request: NextRequest) {
  try {
    // Pour le test, on simule une session valide
    const testUserId = 'test-user-id'

    const { searchParams } = new URL(request.url)
    const context = searchParams.get('context') || 'profile'

    // Validation du contexte
    if (!['profile', 'group'].includes(context)) {
      return NextResponse.json(
        { error: 'Contexte invalide. Utilisez "profile" ou "group"' },
        { status: 400 }
      )
    }

    const currentDate = new Date()
    const currentMonth = currentDate.getMonth() + 1
    const currentYear = currentDate.getFullYear()
    const currentDay = currentDate.getDate()

    // Pour le test, on simule qu'il n'y a pas de récap existant
    const hasExistingRecap = false

    // Force isFirstOfMonth à true pour le test
    const isFirstOfMonth = true
    const required = isFirstOfMonth && !hasExistingRecap

    console.log(`📅 [Monthly Recap Status TEST] Context: ${context}, User: ${testUserId}`)
    console.log(`📅 [Monthly Recap Status TEST] Date: ${currentDay}/${currentMonth}/${currentYear}`)
    console.log(`📅 [Monthly Recap Status TEST] Required: ${required} (First of month: ${isFirstOfMonth}, Has existing: ${hasExistingRecap})`)

    return NextResponse.json({
      required,
      currentMonth,
      currentYear,
      currentDay,
      hasExistingRecap,
      context,
      contextId: testUserId,
      isFirstOfMonth,
      test_mode: true,
      message: 'API de test - Tables de base de données pas encore créées'
    })

  } catch (error) {
    console.error('❌ Erreur lors de la vérification du statut du récap mensuel (TEST):', error)
    return NextResponse.json(
      { error: 'Erreur interne du serveur', details: error.message },
      { status: 500 }
    )
  }
}