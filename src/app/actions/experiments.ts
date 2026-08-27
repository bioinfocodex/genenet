'use server'
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getMockUser } from './auth';

export async function createExperiment(data: FormData) {
  const title = data.get('title') as string;
  const protocol = data.get('protocol') as string;
  const notes = data.get('notes') as string;
  
  let expectedParams = null;
  
  if (protocol.includes('PCR')) {
    const bandSize = data.get('bandSize') as string;
    if (bandSize) {
       expectedParams = JSON.stringify({ bandSizes: bandSize.split(',').map(n => parseInt(n.trim())) });
    }
  } else if (protocol.includes('digestion') || protocol.includes('construction') || protocol.includes('extraction')) {
    const totalBp = parseInt(data.get('totalBp') as string || '0');
    const plasmidName = data.get('plasmidName') as string || 'Vector';
    const cutsRaw = data.get('cuts') as string;
    let cuts: { enzyme: string; position: number }[] = [];
    
    if (cutsRaw) {
       cuts = cutsRaw.split(',').map(c => {
          const parts = c.trim().split(' ');
          return { enzyme: parts[0] || 'Cut', position: parseInt(parts[1] || '0') };
       });
    }
    if (totalBp > 0) {
      expectedParams = JSON.stringify({ plasmidName, totalBp, cuts });
    }
  }

  const user = await getMockUser();
  if (!user) {
    throw new Error("Must be logged in to create experiment");
  }

  await prisma.experiment.create({
    data: {
      title,
      protocol,
      status: 'PLANNED',
      resultData: JSON.stringify({ notes }),
      expectedParams,
      userId: user.id
    }
  });

  await prisma.activity.create({
    data: { action: 'logged a new experiment', target: title, userId: user.id }
  });

  revalidatePath('/experiments');
  revalidatePath('/');
  redirect('/experiments');
}
